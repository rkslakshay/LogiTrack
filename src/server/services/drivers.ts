import type { Prisma } from "@prisma/client";
import { nextCode, prisma, type Db } from "@/lib/db";
import { destroyUserSessions, hashPassword, type SessionUser } from "@/lib/auth";
import { ACTIVE_DELIVERY_STATUSES, humanize } from "@/lib/constants";
import { conflict, notFound } from "@/lib/errors";
import { orderBy, paged, type ListQuery } from "@/lib/list";
import type { DriverInput } from "@/lib/validation";
import { computePerformance } from "@/lib/domain/performance";
import { logActivity } from "./activity";
import { assertStrongPassword } from "./account";
import { setVehicleDriver } from "./vehicles";

const SORTABLE = ["code", "fullName", "status", "licenseExpiry", "joiningDate", "createdAt"] as const;
const vehicleSummary = { select: { id: true, code: true, registrationNumber: true, name: true, type: true, status: true } } as const;
const perfSelect = { driverId: true, status: true, distanceKm: true, expectedAt: true, pickedUpAt: true, deliveredAt: true } as const;

export async function listDrivers(list: ListQuery, filters: { status?: string | null; assigned?: string | null }) {
  const where: Prisma.DriverWhereInput = {
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assigned === "yes" ? { vehicle: { isNot: null } } : {}),
    ...(filters.assigned === "no" ? { vehicle: { is: null } } : {}),
    ...(list.q
      ? {
          OR: [
            { fullName: { contains: list.q } },
            { code: { contains: list.q } },
            { email: { contains: list.q } },
            { phone: { contains: list.q } },
            { licenseNumber: { contains: list.q } },
          ],
        }
      : {}),
  };
  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: { vehicle: vehicleSummary },
      orderBy: orderBy(list, SORTABLE, { createdAt: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.driver.count({ where }),
  ]);
  // Delivery statistics are derived from delivery records, never stored on the driver.
  const deliveries = await prisma.delivery.findMany({ where: { driverId: { in: drivers.map((d) => d.id) } }, select: perfSelect });
  const items = drivers.map((d) => ({
    ...d,
    hasLogin: !!d.userId,
    stats: computePerformance(deliveries.filter((x) => x.driverId === d.id)),
  }));
  return paged(items, total, list);
}

export async function driverOptions() {
  return prisma.driver.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, fullName: true, status: true, licenseExpiry: true, vehicle: { select: { id: true, registrationNumber: true } } },
    orderBy: { fullName: "asc" },
  });
}

export async function getDriver(id: string) {
  const driver = await prisma.driver.findFirst({ where: { id, deletedAt: null }, include: { vehicle: vehicleSummary } });
  if (!driver) throw notFound("Driver");
  const [deliveries, history] = await Promise.all([
    prisma.delivery.findMany({
      where: { driverId: id },
      select: {
        id: true, code: true, customerName: true, pickupAddress: true, destinationAddress: true, status: true, priority: true,
        scheduledAt: true, expectedAt: true, pickedUpAt: true, deliveredAt: true, distanceKm: true,
        vehicle: { select: { id: true, registrationNumber: true } },
      },
      orderBy: { scheduledAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { entityType: "Driver", entityId: id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    ...driver,
    hasLogin: !!driver.userId,
    stats: computePerformance(deliveries),
    deliveries: deliveries.slice(0, 25),
    history,
  };
}

export async function createDriver(actor: SessionUser, input: DriverInput) {
  return prisma.$transaction(async (tx) => {
    const driver = await insertDriver(tx, actor, input);
    return tx.driver.findUniqueOrThrow({ where: { id: driver.id }, include: { vehicle: vehicleSummary } });
  });
}

/** Inserts a driver inside an existing transaction (shared by the form and CSV import). */
export async function insertDriver(tx: Db, actor: SessionUser, input: DriverInput, opts: { quiet?: boolean } = {}) {
  {
    const { assignedVehicleId, loginPassword, ...data } = input;
    let userId: string | null = null;
    if (loginPassword) {
      assertStrongPassword(loginPassword, { email: data.email, name: data.fullName }, "loginPassword");
      const taken = await tx.user.findUnique({ where: { email: data.email } });
      if (taken) throw conflict("A login account with this email already exists.", { email: "Already in use." });
      const user = await tx.user.create({
        data: { name: data.fullName, email: data.email, phone: data.phone, role: "DRIVER", passwordHash: await hashPassword(loginPassword) },
      });
      userId = user.id;
    }
    const code = await nextCode(tx, "driver", "DRV");
    const driver = await tx.driver.create({ data: { ...data, code, userId } });
    if (!opts.quiet) await logActivity(tx, actor, "CREATE", "Driver", driver.id, `Added driver ${driver.fullName} (${code})${userId ? " with a login account" : ""}`);
    if (assignedVehicleId) await setVehicleDriver(tx, actor, assignedVehicleId, driver.id);
    return driver;
  }
}

export async function updateDriver(actor: SessionUser, id: string, input: DriverInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.driver.findFirst({ where: { id, deletedAt: null }, include: { vehicle: true } });
    if (!existing) throw notFound("Driver");
    const { assignedVehicleId, loginPassword, ...data } = input;

    let status: string = data.status;
    if (existing.status === "ON_DELIVERY") {
      if (input.status !== "AVAILABLE") {
        throw conflict("This driver is on a delivery. Complete or reassign the delivery before changing their status.", {
          status: "Driver is currently on a delivery",
        });
      }
      status = "ON_DELIVERY";
    }

    // Keep the linked login account in sync.
    let userId = existing.userId;
    if (loginPassword) assertStrongPassword(loginPassword, { email: data.email, name: data.fullName }, "loginPassword");
    if (userId) {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: data.fullName,
          email: data.email,
          phone: data.phone,
          isActive: status !== "INACTIVE",
          ...(loginPassword ? { passwordHash: await hashPassword(loginPassword) } : {}),
        },
      });
    } else if (loginPassword) {
      const taken = await tx.user.findUnique({ where: { email: data.email } });
      if (taken) throw conflict("A login account with this email already exists.", { email: "Already in use." });
      const user = await tx.user.create({
        data: { name: data.fullName, email: data.email, phone: data.phone, role: "DRIVER", passwordHash: await hashPassword(loginPassword) },
      });
      userId = user.id;
    }

    const driver = await tx.driver.update({ where: { id }, data: { ...data, status, userId } });
    await logActivity(tx, actor, "UPDATE", "Driver", id, `Updated driver ${driver.fullName}`);
    if (existing.status !== status) {
      await logActivity(tx, actor, "STATUS_CHANGE", "Driver", id, `${driver.fullName}: ${humanize(existing.status)} → ${humanize(status)}`);
    }

    const currentVehicleId = existing.vehicle?.id ?? null;
    if (assignedVehicleId !== currentVehicleId) {
      if (currentVehicleId) await setVehicleDriver(tx, actor, currentVehicleId, null);
      if (assignedVehicleId) await setVehicleDriver(tx, actor, assignedVehicleId, id);
    }
    return tx.driver.findUniqueOrThrow({ where: { id }, include: { vehicle: vehicleSummary } });
  }).then(async (driver) => {
    if (driver.status === "INACTIVE" && driver.userId) await destroyUserSessions(driver.userId);
    return driver;
  });
}

/** Deactivates (archives) a driver. History is preserved; the login account is disabled. */
export async function deleteDriver(actor: SessionUser, id: string) {
  const result = await prisma.$transaction(async (tx) => {
    const driver = await tx.driver.findFirst({ where: { id, deletedAt: null } });
    if (!driver) throw notFound("Driver");
    const active = await tx.delivery.count({ where: { driverId: id, status: { in: ACTIVE_DELIVERY_STATUSES } } });
    if (active > 0) {
      throw conflict(`This driver has ${active} active deliver${active === 1 ? "y" : "ies"}. Complete or reassign ${active === 1 ? "it" : "them"} first.`);
    }
    await tx.vehicle.updateMany({ where: { assignedDriverId: id }, data: { assignedDriverId: null } });
    await tx.driver.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    if (driver.userId) await tx.user.update({ where: { id: driver.userId }, data: { isActive: false } });
    await logActivity(tx, actor, "DELETE", "Driver", id, `Deactivated driver ${driver.fullName} (${driver.code})`);
    return { id, userId: driver.userId };
  });
  if (result.userId) await destroyUserSessions(result.userId);
  return { id: result.id };
}
