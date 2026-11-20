import type { Prisma } from "@prisma/client";
import { nextCode, prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { ACTIVE_DELIVERY_STATUSES, humanize, type DeliveryStatus } from "@/lib/constants";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { estimateMinutes } from "@/lib/geo";
import { dateRange, orderBy, paged, type ListQuery } from "@/lib/list";
import { can } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { emitStaff, emitUsers, EVENTS } from "@/lib/realtime";
import { getRoute, localRoute, parseGeometry } from "@/lib/routing";
import type { DeliveryInput } from "@/lib/validation";
import { allowedTransitions, canTransition, isTerminal, manualTransitions } from "@/lib/domain/delivery-status";
import { logActivity } from "./activity";
import { riskFor } from "./intelligence";
import { notifyRoles, notifyUsers, OPS_ROLES } from "./notifications";
import { getSettings } from "./settings";

const deliveryLog = logger("deliveries");

const SORTABLE = ["code", "customerName", "scheduledAt", "expectedAt", "status", "priority", "distanceKm", "createdAt"] as const;

const listInclude = {
  driver: { select: { id: true, code: true, fullName: true, phone: true } },
  vehicle: { select: { id: true, code: true, registrationNumber: true, name: true, type: true } },
} as const;

/** Columns returned in lists: everything except the bulky route geometry. */
const listOmit = { routeGeometry: true } as const;

type Actor = SessionUser | null; // null = system (simulator, reminder sweep)

/** Drivers may only ever see and act on their own deliveries. */
function scopeFor(actor: SessionUser): Prisma.DeliveryWhereInput {
  if (can(actor.role, "deliveries:read")) return {};
  if (can(actor.role, "deliveries:own")) return { driverId: actor.driverId ?? "__no_driver_profile__" };
  throw forbidden();
}

export async function listDeliveries(
  actor: SessionUser,
  list: ListQuery,
  filters: { status?: string | null; priority?: string | null; driverId?: string | null; vehicleId?: string | null; scope?: string | null },
) {
  const statusFilter =
    filters.scope === "active"
      ? { status: { in: ACTIVE_DELIVERY_STATUSES as string[] } }
      : filters.scope === "closed"
        ? { status: { in: ["DELIVERED", "FAILED", "CANCELLED"] } }
        : filters.status
          ? { status: { in: filters.status.split(",") } }
          : {};
  const where: Prisma.DeliveryWhereInput = {
    // The access scope is ANDed in so that no user-supplied filter (e.g. ?driverId=) can widen it.
    AND: [scopeFor(actor)],
    ...statusFilter,
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.driverId ? { driverId: filters.driverId } : {}),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(dateRange(list) ? { scheduledAt: dateRange(list) } : {}),
    ...(list.q
      ? {
          OR: [
            { code: { contains: list.q } },
            { customerName: { contains: list.q } },
            { customerPhone: { contains: list.q } },
            { pickupAddress: { contains: list.q } },
            { destinationAddress: { contains: list.q } },
            { driver: { fullName: { contains: list.q } } },
            { vehicle: { registrationNumber: { contains: list.q } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      omit: listOmit,
      include: listInclude,
      orderBy: orderBy(list, SORTABLE, { scheduledAt: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.delivery.count({ where }),
  ]);
  // Open deliveries carry a rule-based delay-risk assessment (null once closed).
  const risks = await riskFor(items);
  return paged(items.map((d) => ({ ...d, risk: risks.get(d.id) ?? null })), total, list);
}

export async function getDelivery(actor: SessionUser, id: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { AND: [{ id }, scopeFor(actor)] },
    include: {
      driver: { select: { id: true, code: true, fullName: true, phone: true, status: true } },
      vehicle: {
        select: { id: true, code: true, registrationNumber: true, name: true, type: true, status: true, lastLat: true, lastLng: true, lastLocationAt: true },
      },
      route: { select: { id: true, code: true, name: true, status: true } },
      createdBy: { select: { id: true, name: true } },
      events: { include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!delivery) throw notFound("Delivery");
  const { routeGeometry, ...rest } = delivery;
  const status = delivery.status as DeliveryStatus;
  const risks = await riskFor([delivery]);
  return {
    ...rest,
    risk: risks.get(delivery.id) ?? null,
    geometry: parseGeometry(routeGeometry),
    /** Status changes this user may perform right now. */
    nextStatuses: manualTransitions(status, { pickedUp: !!delivery.pickedUpAt }, actor.role),
    canAssign: can(actor.role, "deliveries:write") && (status === "PENDING" || status === "ASSIGNED"),
  };
}

// --- Resource availability ------------------------------------------------------

/**
 * A driver or vehicle may take a new job only when AVAILABLE. Returns the
 * records or throws a 409 explaining exactly why the assignment is not possible.
 */
export async function assertAssignable(db: Db, driverId: string, vehicleId: string, opts: { current?: { driverId: string | null; vehicleId: string | null } } = {}) {
  const [driver, vehicle] = await Promise.all([
    db.driver.findFirst({ where: { id: driverId, deletedAt: null } }),
    db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } }),
  ]);
  if (!driver) throw notFound("Driver");
  if (!vehicle) throw notFound("Vehicle");

  const sameDriver = opts.current?.driverId === driverId;
  const sameVehicle = opts.current?.vehicleId === vehicleId;
  if (!sameDriver && driver.status !== "AVAILABLE") {
    throw conflict(`${driver.fullName} is ${humanize(driver.status).toLowerCase()} and cannot take a new delivery.`, {
      driverId: `Driver is ${humanize(driver.status).toLowerCase()}`,
    });
  }
  if (driver.licenseExpiry < new Date()) {
    throw conflict(`${driver.fullName}'s driving licence has expired.`, { driverId: "Driving licence has expired" });
  }
  if (!sameVehicle && vehicle.status !== "AVAILABLE") {
    throw conflict(`${vehicle.registrationNumber} is ${humanize(vehicle.status).toLowerCase()} and cannot take a new delivery.`, {
      vehicleId: `Vehicle is ${humanize(vehicle.status).toLowerCase()}`,
    });
  }
  return { driver, vehicle };
}

/** Frees the driver/vehicle when they have no other active delivery. */
export async function releaseResources(db: Db, driverId: string | null, vehicleId: string | null, exceptDeliveryId: string) {
  if (driverId) {
    const others = await db.delivery.count({
      where: { driverId, id: { not: exceptDeliveryId }, status: { in: ACTIVE_DELIVERY_STATUSES } },
    });
    if (others === 0) await db.driver.updateMany({ where: { id: driverId, status: "ON_DELIVERY" }, data: { status: "AVAILABLE" } });
  }
  if (vehicleId) {
    const others = await db.delivery.count({
      where: { vehicleId, id: { not: exceptDeliveryId }, status: { in: ACTIVE_DELIVERY_STATUSES } },
    });
    if (others === 0) await db.vehicle.updateMany({ where: { id: vehicleId, status: "ON_DELIVERY" }, data: { status: "AVAILABLE" } });
  }
}

/** Keeps a multi-stop route's status in step with its deliveries. */
async function syncRouteStatus(db: Db, routeId: string | null) {
  if (!routeId) return;
  const deliveries = await db.delivery.findMany({ where: { routeId }, select: { status: true, pickedUpAt: true } });
  if (deliveries.length === 0) return;
  let status = "PLANNED";
  if (deliveries.every((d) => isTerminal(d.status))) {
    status = deliveries.some((d) => d.status === "DELIVERED" || d.status === "FAILED") ? "COMPLETED" : "CANCELLED";
  } else if (deliveries.some((d) => d.pickedUpAt || isTerminal(d.status))) status = "IN_PROGRESS";
  await db.route.updateMany({ where: { id: routeId, status: { not: status } }, data: { status } });
}

function broadcast(delivery: { id: string; code: string; status: string; driverId: string | null; vehicleId: string | null }, driverUserId?: string | null) {
  const payload = { id: delivery.id, code: delivery.code, status: delivery.status, driverId: delivery.driverId, vehicleId: delivery.vehicleId };
  emitStaff(EVENTS.deliveryUpdated, payload);
  emitUsers([driverUserId], EVENTS.deliveryUpdated, payload);
}

// --- Create / update / delete ---------------------------------------------------

async function routeFor(input: Pick<DeliveryInput, "pickupLat" | "pickupLng" | "destLat" | "destLng">) {
  const [route, settings] = await Promise.all([
    getRoute([
      [input.pickupLat, input.pickupLng],
      [input.destLat, input.destLng],
    ]),
    getSettings(),
  ]);
  return {
    distanceKm: route.distanceKm,
    estimatedMinutes: estimateMinutes(route.distanceKm, settings.averageSpeedKmh),
    routeGeometry: JSON.stringify(route.geometry),
    geometrySource: route.source,
  };
}

/**
 * The only columns a create or edit may set. Listing them explicitly (instead of spreading the
 * input) means a caller can never write status, assignment, timestamps or progress through
 * this path, whatever extra properties the object carries.
 */
function editableFields(input: DeliveryInput) {
  return {
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    pickupAddress: input.pickupAddress,
    destinationAddress: input.destinationAddress,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    destLat: input.destLat,
    destLng: input.destLng,
    scheduledAt: input.scheduledAt,
    expectedAt: input.expectedAt,
    priority: input.priority,
    notes: input.notes,
  };
}

/**
 * Inserts an unassigned (pending) delivery inside an existing transaction, for CSV
 * import. The route is the offline estimate, computed without any network call;
 * the simulator upgrades it to road geometry later when OSRM is configured.
 */
export async function insertPendingDelivery(tx: Db, actor: SessionUser, input: DeliveryInput, averageSpeedKmh: number) {
  const data = editableFields(input);
  const est = localRoute([[input.pickupLat, input.pickupLng], [input.destLat, input.destLng]]);
  const code = await nextCode(tx, "delivery", "DEL");
  const created = await tx.delivery.create({
    data: {
      ...data, code, createdById: actor.id, distanceKm: est.distanceKm, estimatedMinutes: estimateMinutes(est.distanceKm, averageSpeedKmh),
      routeGeometry: JSON.stringify(est.geometry), geometrySource: "local",
    },
  });
  await tx.deliveryEvent.create({ data: { deliveryId: created.id, type: "CREATED", status: "PENDING", note: "Imported from CSV", userId: actor.id } });
  return created;
}

export async function createDelivery(actor: SessionUser, input: DeliveryInput) {
  const { driverId, vehicleId } = input;
  const data = editableFields(input);
  const route = await routeFor(input); // network call kept outside the transaction
  const delivery = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, "delivery", "DEL");
    const created = await tx.delivery.create({ data: { ...data, ...route, code, createdById: actor.id } });
    await tx.deliveryEvent.create({
      data: { deliveryId: created.id, type: "CREATED", status: "PENDING", note: "Delivery created", userId: actor.id },
    });
    await logActivity(tx, actor, "CREATE", "Delivery", created.id, `Created delivery ${code} for ${created.customerName}`);
    return created;
  });
  if (driverId && vehicleId) return assignDelivery(actor, delivery.id, { driverId, vehicleId });
  broadcast(delivery);
  return getDelivery(actor, delivery.id);
}

export async function updateDelivery(actor: SessionUser, id: string, input: DeliveryInput) {
  const existing = await prisma.delivery.findUnique({ where: { id } });
  if (!existing) throw notFound("Delivery");
  if (isTerminal(existing.status)) throw conflict(`A ${humanize(existing.status).toLowerCase()} delivery can no longer be edited.`);

  // driverId / vehicleId are handled by the dedicated assign endpoint.
  const data = editableFields(input);
  const moved =
    existing.pickupLat !== data.pickupLat || existing.pickupLng !== data.pickupLng ||
    existing.destLat !== data.destLat || existing.destLng !== data.destLng;
  if (moved && existing.pickedUpAt) {
    throw conflict("Locations cannot be changed after the goods have been picked up.", { pickupAddress: "Already picked up" });
  }
  const route = moved ? await routeFor(data) : {};

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id }, data: { ...data, ...route, ...(moved ? { progress: 0 } : {}) } });
    await tx.deliveryEvent.create({
      data: { deliveryId: id, type: "UPDATED", status: existing.status, note: moved ? "Delivery details and route updated" : "Delivery details updated", userId: actor.id },
    });
    await logActivity(tx, actor, "UPDATE", "Delivery", id, `Updated delivery ${existing.code}`);
  });
  broadcast(existing);
  return getDelivery(actor, id);
}

export async function deleteDelivery(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id } });
    if (!delivery) throw notFound("Delivery");
    // Only records with no operational history may be removed; everything else is kept for audit.
    if (delivery.status !== "PENDING" && delivery.status !== "CANCELLED") {
      throw conflict(
        `Only pending or cancelled deliveries can be deleted. This delivery is ${humanize(delivery.status).toLowerCase()}${isTerminal(delivery.status) ? " and is kept for records" : " — cancel it first"}.`,
      );
    }
    await tx.delivery.delete({ where: { id } });
    await logActivity(tx, actor, "DELETE", "Delivery", id, `Deleted delivery ${delivery.code} (${delivery.customerName})`);
    return { id };
  });
}

// --- Assignment -----------------------------------------------------------------

/**
 * Assigns several deliveries to one driver + vehicle in a single step.
 * Used for single assignment and for multi-stop routes.
 */
export async function assignMany(db: Db, actor: Actor, deliveryIds: string[], driverId: string, vehicleId: string, routeId?: string) {
  const deliveries = await db.delivery.findMany({ where: { id: { in: deliveryIds } } });
  if (deliveries.length !== deliveryIds.length) throw notFound("Delivery");
  for (const d of deliveries) {
    if (d.status !== "PENDING" && d.status !== "ASSIGNED") {
      throw conflict(`${d.code} is ${humanize(d.status).toLowerCase()} and can no longer be reassigned.`);
    }
  }
  // If every delivery already belongs to this driver/vehicle they stay "current".
  const current = deliveries.length === 1 ? { driverId: deliveries[0].driverId, vehicleId: deliveries[0].vehicleId } : undefined;
  const { driver, vehicle } = await assertAssignable(db, driverId, vehicleId, { current });

  for (const d of deliveries) {
    const reassigned = d.status === "ASSIGNED" && (d.driverId !== driverId || d.vehicleId !== vehicleId);
    // Guarded write: only a delivery that is still pending/assigned can be (re)assigned.
    const moved = await db.delivery.updateMany({
      where: { id: d.id, status: { in: ["PENDING", "ASSIGNED"] } },
      data: { driverId, vehicleId, status: "ASSIGNED", ...(routeId ? { routeId } : {}) },
    });
    if (moved.count !== 1) throw conflict(`${d.code} was changed by someone else. Refresh and try again.`);
    if (reassigned) await releaseResources(db, d.driverId, d.vehicleId, d.id);
    await db.deliveryEvent.create({
      data: {
        deliveryId: d.id,
        type: "ASSIGNMENT",
        status: "ASSIGNED",
        note: `${reassigned ? "Reassigned" : "Assigned"} to ${driver.fullName} with ${vehicle.registrationNumber}`,
        userId: actor?.id ?? null,
      },
    });
    await logActivity(db, actor, "ASSIGN", "Delivery", d.id, `Assigned ${d.code} to ${driver.fullName} / ${vehicle.registrationNumber}`);
  }
  // Claim the crew with conditional updates: if another request took the driver or vehicle
  // between our availability check and now, the row no longer matches and we abort.
  // (A crew that already holds this very delivery keeps it; anyone else must still be AVAILABLE.)
  const keepsDriver = current?.driverId === driverId;
  const keepsVehicle = current?.vehicleId === vehicleId;
  const claimedDriver = await db.driver.updateMany({
    where: { id: driverId, status: keepsDriver ? { in: ["AVAILABLE", "ON_DELIVERY"] } : "AVAILABLE", deletedAt: null },
    data: { status: "ON_DELIVERY" },
  });
  const claimedVehicle = await db.vehicle.updateMany({
    where: { id: vehicleId, status: keepsVehicle ? { in: ["AVAILABLE", "ON_DELIVERY"] } : "AVAILABLE", deletedAt: null },
    data: { status: "ON_DELIVERY" },
  });
  if (claimedDriver.count !== 1 || claimedVehicle.count !== 1) {
    throw conflict("The driver or vehicle was just taken by another assignment. Please choose again.");
  }

  await notifyUsers(db, [driver.userId], {
    category: "DELIVERY",
    title: deliveries.length === 1 ? "New delivery assigned" : `${deliveries.length} deliveries assigned`,
    message:
      deliveries.length === 1
        ? `${deliveries[0].code}: ${deliveries[0].pickupAddress} → ${deliveries[0].destinationAddress} with ${vehicle.registrationNumber}.`
        : `You have ${deliveries.length} new deliveries with ${vehicle.registrationNumber}.`,
    entityType: "Delivery",
    entityId: deliveries[0].id,
  });
  await notifyRoles(db, OPS_ROLES, {
    category: "DELIVERY",
    title: "Delivery assigned",
    message: `${deliveries.map((d) => d.code).join(", ")} assigned to ${driver.fullName} (${vehicle.registrationNumber}).`,
    entityType: "Delivery",
    entityId: deliveries[0].id,
  });
  return { driver, vehicle, deliveries };
}

export async function assignDelivery(actor: SessionUser, id: string, input: { driverId: string; vehicleId: string }) {
  const result = await prisma.$transaction((tx) => assignMany(tx, actor, [id], input.driverId, input.vehicleId));
  for (const d of result.deliveries) broadcast({ ...d, status: "ASSIGNED", driverId: input.driverId, vehicleId: input.vehicleId }, result.driver.userId);
  return getDelivery(actor, id);
}

export async function unassignDelivery(actor: SessionUser, id: string) {
  const delivery = await prisma.$transaction(async (tx) => {
    const d = await tx.delivery.findUnique({ where: { id }, include: { driver: true, vehicle: true } });
    if (!d) throw notFound("Delivery");
    if (d.status !== "ASSIGNED") throw conflict("Only an assigned delivery that has not been picked up can be unassigned.");
    await tx.delivery.update({ where: { id }, data: { status: "PENDING", driverId: null, vehicleId: null, routeId: null } });
    await releaseResources(tx, d.driverId, d.vehicleId, id);
    await tx.deliveryEvent.create({
      data: { deliveryId: id, type: "ASSIGNMENT", status: "PENDING", note: `Unassigned from ${d.driver?.fullName ?? "driver"}`, userId: actor.id },
    });
    await logActivity(tx, actor, "UNASSIGN", "Delivery", id, `Unassigned ${d.code} from ${d.driver?.fullName ?? "driver"}`);
    await syncRouteStatus(tx, d.routeId);
    return d;
  });
  broadcast({ ...delivery, status: "PENDING", driverId: null, vehicleId: null }, delivery.driver?.userId);
  return getDelivery(actor, id);
}

// --- Status changes -------------------------------------------------------------

/**
 * Moves a delivery through the state machine and applies every side effect:
 * timestamps, driver/vehicle availability, odometer, event history, audit log,
 * notifications, route status and realtime broadcast.
 */
export async function changeDeliveryStatus(actor: Actor, id: string, input: { status: DeliveryStatus; note?: string | null }) {
  const to = input.status;
  const result = await prisma.$transaction(async (tx) => {
    const d = await tx.delivery.findUnique({ where: { id }, include: { driver: true, vehicle: true } });
    if (!d) throw notFound("Delivery");
    const from = d.status as DeliveryStatus;
    const ctx = { pickedUp: !!d.pickedUpAt };

    if (actor) {
      const own = actor.driverId != null && d.driverId === actor.driverId;
      if (!can(actor.role, "deliveries:status")) {
        // Drivers: only their own deliveries, and only driver-appropriate transitions.
        if (!(can(actor.role, "deliveries:own") && own)) throw notFound("Delivery");
        if (!manualTransitions(from, ctx, actor.role).includes(to)) {
          throw forbidden(`Drivers cannot mark a delivery as ${humanize(to).toLowerCase()}.`);
        }
      }
    }
    if (to === "ASSIGNED") throw badRequest("Use the assign action to assign a driver and vehicle.");
    if (to === "PENDING") throw badRequest("Use the unassign action to return a delivery to pending.");
    if (from === to) throw conflict(`Delivery is already ${humanize(to).toLowerCase()}.`);
    if (!canTransition(from, to, ctx)) {
      const options = allowedTransitions(from, ctx).filter((s) => s !== "ASSIGNED" && s !== "PENDING").map(humanize);
      throw conflict(
        `A ${humanize(from).toLowerCase()} delivery cannot be changed to ${humanize(to).toLowerCase()}.` +
          (options.length ? ` Allowed: ${options.join(", ")}.` : " It is closed."),
      );
    }
    if ((to === "FAILED" || to === "DELAYED" || to === "CANCELLED") && actor && !input.note) {
      throw badRequest("Please add a note explaining the reason.", { note: "A reason is required" });
    }

    const now = new Date();
    const data: Prisma.DeliveryUpdateInput = { status: to };
    if (to === "PICKED_UP") data.pickedUpAt = d.pickedUpAt ?? now;
    if (to === "IN_TRANSIT" && !d.pickedUpAt) data.pickedUpAt = now;
    if (to === "DELIVERED") {
      data.deliveredAt = now;
      data.progress = 1;
    }
    if (isTerminal(to)) data.closedAt = now;
    // Guarded write: the transition only applies if the status is still the one we validated,
    // so two simultaneous updates cannot both succeed (no double completion, no double release).
    const applied = await tx.delivery.updateMany({ where: { id, status: from }, data: data as Prisma.DeliveryUpdateManyMutationInput });
    if (applied.count !== 1) throw conflict(`${d.code} was updated by someone else at the same time. Refresh and try again.`);

    if (isTerminal(to)) {
      await releaseResources(tx, d.driverId, d.vehicleId, id);
      if (to === "DELIVERED" && d.vehicleId) {
        // The trip is done: add its distance to the odometer and park the vehicle at the destination.
        await tx.vehicle.update({
          where: { id: d.vehicleId },
          data: { odometer: { increment: Math.round(d.distanceKm) }, lastLat: d.destLat, lastLng: d.destLng, lastLocationAt: now },
        });
      }
    }

    await tx.deliveryEvent.create({
      data: { deliveryId: id, type: "STATUS_CHANGE", status: to, note: input.note ?? (actor ? null : "Updated automatically"), userId: actor?.id ?? null },
    });
    await logActivity(tx, actor, "STATUS_CHANGE", "Delivery", id, `${d.code}: ${humanize(from)} → ${humanize(to)}${input.note ? ` (${input.note})` : ""}`);
    deliveryLog.info("delivery.status_changed", { delivery: d.code, from, to, by: actor?.id ?? "system" });

    const who = d.driver ? ` by ${d.driver.fullName}` : "";
    if (to === "DELIVERED") {
      const late = now > d.expectedAt;
      await notifyRoles(tx, OPS_ROLES, {
        category: "DELIVERY", severity: late ? "WARNING" : "SUCCESS",
        title: late ? "Delivery completed late" : "Delivery completed",
        message: `${d.code} for ${d.customerName} was delivered${who}${late ? " after the expected time" : " on time"}.`,
        entityType: "Delivery", entityId: id,
      }, [d.createdById]);
    } else if (to === "DELAYED") {
      await notifyRoles(tx, OPS_ROLES, {
        category: "DELIVERY", severity: "WARNING", title: "Delivery delayed",
        message: `${d.code} for ${d.customerName} is delayed${input.note ? `: ${input.note}` : " (past its expected time)"}.`,
        entityType: "Delivery", entityId: id,
      }, [d.driver?.userId]);
    } else if (to === "FAILED") {
      await notifyRoles(tx, OPS_ROLES, {
        category: "DELIVERY", severity: "CRITICAL", title: "Delivery failed",
        message: `${d.code} for ${d.customerName} failed${input.note ? `: ${input.note}` : ""}.`,
        entityType: "Delivery", entityId: id,
      });
    } else if (to === "CANCELLED") {
      await notifyUsers(tx, [d.driver?.userId], {
        category: "DELIVERY", severity: "WARNING", title: "Delivery cancelled",
        message: `${d.code} (${d.destinationAddress}) has been cancelled.`,
        entityType: "Delivery", entityId: id,
      });
    }
    if (isTerminal(to) && d.vehicle && d.vehicleId) {
      const vehicle = await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { status: true } });
      if (vehicle?.status === "AVAILABLE" && d.vehicle.status !== "AVAILABLE") {
        await notifyRoles(tx, ["SUPER_ADMIN", "FLEET_MANAGER"], {
          category: "VEHICLE", severity: "INFO", title: "Vehicle available",
          message: `${d.vehicle.registrationNumber} is available again after ${d.code}.`,
          entityType: "Vehicle", entityId: d.vehicleId,
        });
      }
    }
    await syncRouteStatus(tx, d.routeId);
    return d;
  });
  broadcast({ ...result, status: to }, result.driver?.userId);
  return result;
}

/** A driver (or dispatcher) flags a problem without changing the delivery status. */
export async function reportIssue(actor: SessionUser, id: string, note: string) {
  const delivery = await prisma.delivery.findFirst({ where: { AND: [{ id }, scopeFor(actor)] }, include: { driver: true } });
  if (!delivery) throw notFound("Delivery");
  if (isTerminal(delivery.status)) throw conflict("This delivery is already closed.");
  await prisma.$transaction(async (tx) => {
    await tx.deliveryEvent.create({ data: { deliveryId: id, type: "ISSUE", status: delivery.status, note, userId: actor.id } });
    await logActivity(tx, actor, "UPDATE", "Delivery", id, `Issue reported on ${delivery.code}: ${note}`);
    await notifyRoles(tx, OPS_ROLES, {
      category: "DELIVERY", severity: "WARNING", title: "Delivery issue reported",
      message: `${actor.name} reported an issue on ${delivery.code}: ${note}`,
      entityType: "Delivery", entityId: id,
    });
  });
  broadcast(delivery, delivery.driver?.userId);
  return getDelivery(actor, id);
}

/**
 * Automated delay detection: active deliveries past their expected time are
 * moved to DELAYED by the system. Returns the number of deliveries flagged.
 */
export async function flagOverdueDeliveries(now = new Date()): Promise<number> {
  const overdue = await prisma.delivery.findMany({
    where: { status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] }, expectedAt: { lt: now } },
    select: { id: true },
  });
  let flagged = 0;
  for (const d of overdue) {
    try {
      await changeDeliveryStatus(null, d.id, { status: "DELAYED", note: "Automatically flagged: expected delivery time has passed" });
      flagged++;
    } catch {
      // Status changed concurrently; nothing to do.
    }
  }
  return flagged;
}
