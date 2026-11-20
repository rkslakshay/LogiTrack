import { nextCode, prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { conflict, notFound } from "@/lib/errors";
import { compareTours, estimateMinutes, ROAD_CIRCUITY, haversineKm, type LatLng, type Precedence } from "@/lib/geo";
import { orderBy, paged, type ListQuery } from "@/lib/list";
import { emitStaff, emitUsers, EVENTS } from "@/lib/realtime";
import { getRoute, localRoute } from "@/lib/routing";
import { logActivity } from "./activity";
import { assignMany, releaseResources } from "./deliveries";
import { getSettings } from "./settings";

type Strategy = "original" | "nearestNeighbor" | "optimized";

interface PlanInput {
  start: { label: string; lat: number; lng: number };
  deliveryIds: string[];
  strategy: Strategy;
}

export interface PlannedStop {
  sequence: number;
  type: "START" | "PICKUP" | "DROPOFF";
  label: string;
  lat: number;
  lng: number;
  legKm: number;
  deliveryId: string | null;
  deliveryCode: string | null;
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  original: "As entered",
  nearestNeighbor: "Nearest neighbour",
  optimized: "Nearest neighbour + 2-opt",
};

/**
 * Builds a pickup-and-delivery plan: every delivery contributes a PICKUP stop and
 * a DROPOFF stop, and the optimiser keeps each pickup ahead of its drop-off.
 */
async function plan(input: PlanInput, opts: { allowRemote: boolean }) {
  const deliveries = await prisma.delivery.findMany({ where: { id: { in: input.deliveryIds } } });
  if (deliveries.length !== input.deliveryIds.length) throw notFound("Delivery");
  for (const d of deliveries) {
    if (d.status !== "PENDING") throw conflict(`${d.code} is no longer pending and cannot be added to a new route.`);
    if (d.routeId) throw conflict(`${d.code} is already part of another route.`);
  }
  // Preserve the order in which the dispatcher selected the deliveries.
  const ordered = input.deliveryIds.map((id) => deliveries.find((d) => d.id === id)!);

  const start: LatLng = [input.start.lat, input.start.lng];
  const points: LatLng[] = [];
  const meta: { type: "PICKUP" | "DROPOFF"; label: string; deliveryId: string; code: string }[] = [];
  const before: Precedence = [];
  for (const d of ordered) {
    const pickupIndex = points.length;
    points.push([d.pickupLat, d.pickupLng]);
    meta.push({ type: "PICKUP", label: d.pickupAddress, deliveryId: d.id, code: d.code });
    before.push(null);
    points.push([d.destLat, d.destLng]);
    meta.push({ type: "DROPOFF", label: d.destinationAddress, deliveryId: d.id, code: d.code });
    before.push(pickupIndex);
  }

  const settings = await getSettings();
  const tours = compareTours(start, points, before);
  const options = (Object.keys(tours) as Strategy[]).map((key) => {
    const km = Math.round(tours[key].straightLineKm * ROAD_CIRCUITY * 10) / 10;
    return {
      strategy: key,
      label: STRATEGY_LABELS[key],
      algorithm: tours[key].algorithm,
      distanceKm: km,
      estimatedMinutes: estimateMinutes(km, settings.averageSpeedKmh, points.length),
    };
  });

  const chosen = tours[input.strategy];
  const waypoints: LatLng[] = [start, ...chosen.order.map((i) => points[i])];
  const road = opts.allowRemote ? await getRoute(waypoints) : localRoute(waypoints);

  const stops: PlannedStop[] = [
    { sequence: 0, type: "START", label: input.start.label, lat: start[0], lng: start[1], legKm: 0, deliveryId: null, deliveryCode: null },
  ];
  let prev = start;
  chosen.order.forEach((idx, i) => {
    const p = points[idx];
    stops.push({
      sequence: i + 1,
      type: meta[idx].type,
      label: meta[idx].label,
      lat: p[0],
      lng: p[1],
      legKm: Math.round(haversineKm(prev, p) * ROAD_CIRCUITY * 10) / 10,
      deliveryId: meta[idx].deliveryId,
      deliveryCode: meta[idx].code,
    });
    prev = p;
  });

  const baseline = options.find((o) => o.strategy === "original")!.distanceKm;
  const selected = options.find((o) => o.strategy === input.strategy)!;
  return {
    options,
    selected: {
      strategy: input.strategy,
      algorithm: chosen.algorithm,
      stops,
      geometry: road.geometry,
      geometrySource: road.source,
      distanceKm: road.distanceKm,
      estimatedMinutes: estimateMinutes(road.distanceKm, settings.averageSpeedKmh, points.length),
      stopCount: points.length,
      savedKm: Math.max(0, Math.round((baseline - selected.distanceKm) * 10) / 10),
    },
  };
}

export function previewRoute(input: PlanInput) {
  return plan(input, { allowRemote: true });
}

/** Point-to-point estimate used by the single-delivery planner. */
export async function pointToPoint(from: LatLng, to: LatLng) {
  const settings = await getSettings();
  const [road, local] = await Promise.all([getRoute([from, to]), Promise.resolve(localRoute([from, to]))]);
  const straightKm = Math.round(haversineKm(from, to) * 10) / 10;
  return {
    straightLineKm: straightKm,
    options: [
      {
        key: road.source === "osrm" ? "road" : "estimate",
        label: road.source === "osrm" ? "Road route (OpenStreetMap / OSRM)" : "Estimated road distance (offline)",
        distanceKm: road.distanceKm,
        estimatedMinutes: estimateMinutes(road.distanceKm, settings.averageSpeedKmh),
        geometry: road.geometry,
        source: road.source,
      },
      ...(road.source === "osrm"
        ? [
            {
              key: "estimate",
              label: "Straight-line estimate × 1.3 (offline fallback)",
              distanceKm: local.distanceKm,
              estimatedMinutes: estimateMinutes(local.distanceKm, settings.averageSpeedKmh),
              geometry: local.geometry,
              source: local.source,
            },
          ]
        : []),
    ],
    averageSpeedKmh: settings.averageSpeedKmh,
  };
}

export async function createRoute(
  actor: SessionUser,
  input: PlanInput & { name: string; driverId: string | null; vehicleId: string | null },
) {
  if (!!input.driverId !== !!input.vehicleId) {
    throw conflict("Select both a driver and a vehicle, or neither.", { vehicleId: "Select both a driver and a vehicle" });
  }
  const planned = await plan(input, { allowRemote: true });
  const { selected } = planned;

  const result = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, "route", "RTE");
    const route = await tx.route.create({
      data: {
        code,
        name: input.name,
        algorithm: selected.algorithm,
        totalDistanceKm: selected.distanceKm,
        estimatedMinutes: selected.estimatedMinutes,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        createdById: actor.id,
        stops: {
          create: selected.stops.map((s) => ({
            sequence: s.sequence, type: s.type, label: s.label, lat: s.lat, lng: s.lng, legKm: s.legKm, deliveryId: s.deliveryId,
          })),
        },
      },
    });
    await tx.delivery.updateMany({ where: { id: { in: input.deliveryIds } }, data: { routeId: route.id } });
    await logActivity(tx, actor, "CREATE", "Route", route.id, `Planned route ${code} "${input.name}" with ${input.deliveryIds.length} deliveries (${selected.distanceKm} km)`);
    let driverUserId: string | null = null;
    if (input.driverId && input.vehicleId) {
      const assigned = await assignMany(tx, actor, input.deliveryIds, input.driverId, input.vehicleId, route.id);
      driverUserId = assigned.driver.userId;
    }
    return { route, driverUserId };
  });
  emitStaff(EVENTS.deliveryUpdated, { routeId: result.route.id });
  emitUsers([result.driverUserId], EVENTS.deliveryUpdated, { routeId: result.route.id });
  return getRouteById(result.route.id);
}

export async function assignRoute(actor: SessionUser, id: string, input: { driverId: string; vehicleId: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const route = await tx.route.findUnique({ where: { id }, include: { deliveries: true } });
    if (!route) throw notFound("Route");
    if (route.status !== "PLANNED") throw conflict("Only a planned route can be (re)assigned.");
    const pending = route.deliveries.filter((d) => d.status === "PENDING" || d.status === "ASSIGNED");
    if (pending.length === 0) throw conflict("This route has no deliveries left to assign.");
    // Free the previous crew first so reassignment to the same people passes the availability check.
    for (const d of pending) {
      if (d.status === "ASSIGNED") {
        await tx.delivery.update({ where: { id: d.id }, data: { status: "PENDING", driverId: null, vehicleId: null } });
        await releaseResources(tx, d.driverId, d.vehicleId, d.id);
      }
    }
    const assigned = await assignMany(tx, actor, pending.map((d) => d.id), input.driverId, input.vehicleId, id);
    await tx.route.update({ where: { id }, data: { driverId: input.driverId, vehicleId: input.vehicleId } });
    await logActivity(tx, actor, "ASSIGN", "Route", id, `Assigned route ${route.code} to ${assigned.driver.fullName} / ${assigned.vehicle.registrationNumber}`);
    return assigned.driver.userId;
  });
  emitStaff(EVENTS.deliveryUpdated, { routeId: id });
  emitUsers([result], EVENTS.deliveryUpdated, { routeId: id });
  return getRouteById(id);
}

export async function listRoutes(list: ListQuery, filters: { status?: string | null }) {
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q } }, { code: { contains: list.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.route.findMany({
      where,
      include: {
        driver: { select: { id: true, fullName: true } },
        vehicle: { select: { id: true, registrationNumber: true } },
        _count: { select: { deliveries: true, stops: true } },
      },
      orderBy: orderBy(list, ["code", "name", "status", "totalDistanceKm", "createdAt"] as const, { createdAt: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.route.count({ where }),
  ]);
  return paged(items, total, list);
}

export async function getRouteById(id: string) {
  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, fullName: true, phone: true } },
      vehicle: { select: { id: true, registrationNumber: true, name: true } },
      stops: { orderBy: { sequence: "asc" }, include: { delivery: { select: { id: true, code: true, status: true, customerName: true } } } },
      deliveries: { select: { id: true, code: true, status: true, customerName: true, destinationAddress: true } },
    },
  });
  if (!route) throw notFound("Route");
  // Geometry is re-derived from the saved stops (offline estimator) for display.
  const geometry = localRoute(route.stops.map((s) => [s.lat, s.lng] as LatLng)).geometry;
  return { ...route, geometry };
}

/** Deleting a route releases its deliveries back to the pending pool. */
export async function deleteRoute(actor: SessionUser, id: string) {
  await prisma.$transaction(async (tx) => {
    const route = await tx.route.findUnique({ where: { id }, include: { deliveries: true } });
    if (!route) throw notFound("Route");
    if (route.status === "IN_PROGRESS") throw conflict("A route that is in progress cannot be deleted.");
    for (const d of route.deliveries) {
      if (d.status === "ASSIGNED") {
        await tx.delivery.update({ where: { id: d.id }, data: { status: "PENDING", driverId: null, vehicleId: null } });
        await releaseResources(tx, d.driverId, d.vehicleId, d.id);
        await tx.deliveryEvent.create({
          data: { deliveryId: d.id, type: "ASSIGNMENT", status: "PENDING", note: `Route ${route.code} was deleted; delivery returned to pending`, userId: actor.id },
        });
      }
    }
    await tx.route.delete({ where: { id } }); // stops cascade; deliveries.routeId is set to null
    await logActivity(tx, actor, "DELETE", "Route", id, `Deleted route ${route.code} "${route.name}"`);
  });
  emitStaff(EVENTS.deliveryUpdated, { routeId: id });
  return { id };
}
