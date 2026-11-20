import type { Prisma } from "@prisma/client";
import { nextCode, prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { ACTIVE_DELIVERY_STATUSES, humanize } from "@/lib/constants";
import { conflict, notFound } from "@/lib/errors";
import { orderBy, paged, type ListQuery } from "@/lib/list";
import type { VehicleInput } from "@/lib/validation";
import { computeFuelStats } from "@/lib/domain/fuel";
import { logActivity } from "./activity";
import { FLEET_ROLES, notifyRoles } from "./notifications";

const SORTABLE = ["code", "registrationNumber", "name", "type", "status", "odometer", "year", "insuranceExpiry", "createdAt"] as const;

const driverSummary = { select: { id: true, code: true, fullName: true, phone: true, status: true } } as const;

export async function listVehicles(
  list: ListQuery,
  filters: { type?: string | null; status?: string | null; fuelType?: string | null },
) {
  const where: Prisma.VehicleWhereInput = {
    deletedAt: null,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.fuelType ? { fuelType: filters.fuelType } : {}),
    ...(list.q
      ? {
          OR: [
            { registrationNumber: { contains: list.q } },
            { name: { contains: list.q } },
            { code: { contains: list.q } },
            { manufacturer: { contains: list.q } },
            { model: { contains: list.q } },
            { assignedDriver: { fullName: { contains: list.q } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      include: { assignedDriver: driverSummary },
      orderBy: orderBy(list, SORTABLE, { createdAt: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.vehicle.count({ where }),
  ]);
  return paged(items, total, list);
}

/** Compact list for dropdowns. */
export async function vehicleOptions() {
  return prisma.vehicle.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      registrationNumber: true,
      name: true,
      type: true,
      status: true,
      odometer: true,
      assignedDriverId: true,
      lastLat: true,
      lastLng: true,
    },
    orderBy: { registrationNumber: "asc" },
  });
}

export async function getVehicle(id: string) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id, deletedAt: null },
    include: { assignedDriver: driverSummary },
  });
  if (!vehicle) throw notFound("Vehicle");

  const [deliveries, fuel, maintenance, history, deliveryCounts, distance, maintenanceCost] = await Promise.all([
    prisma.delivery.findMany({
      where: { vehicleId: id },
      select: {
        id: true, code: true, customerName: true, destinationAddress: true, status: true,
        scheduledAt: true, deliveredAt: true, distanceKm: true, driver: { select: { id: true, fullName: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: 15,
    }),
    prisma.fuelRecord.findMany({ where: { vehicleId: id }, orderBy: { date: "desc" } }),
    prisma.maintenanceRecord.findMany({ where: { vehicleId: id }, orderBy: { serviceDate: "desc" }, take: 15 }),
    prisma.activityLog.findMany({
      where: { entityType: "Vehicle", entityId: id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.delivery.groupBy({ by: ["status"], where: { vehicleId: id }, _count: true }),
    prisma.delivery.aggregate({ where: { vehicleId: id, status: "DELIVERED" }, _sum: { distanceKm: true } }),
    prisma.maintenanceRecord.aggregate({ where: { vehicleId: id, status: "COMPLETED" }, _sum: { costPaise: true } }),
  ]);

  const count = (s: string) => deliveryCounts.find((c) => c.status === s)?._count ?? 0;
  return {
    ...vehicle,
    deliveries,
    fuelRecords: fuel.slice(0, 15),
    maintenance,
    history,
    stats: {
      totalDeliveries: deliveryCounts.reduce((s, c) => s + c._count, 0),
      delivered: count("DELIVERED"),
      failed: count("FAILED"),
      deliveredKm: Math.round((distance._sum.distanceKm ?? 0) * 10) / 10,
      maintenanceCostPaise: maintenanceCost._sum.costPaise ?? 0,
      fuel: computeFuelStats(fuel),
    },
  };
}

async function assertDriverAssignable(db: Db, driverId: string) {
  const driver = await db.driver.findFirst({ where: { id: driverId, deletedAt: null } });
  if (!driver) throw notFound("Driver");
  if (driver.status === "INACTIVE") throw conflict("An inactive driver cannot be assigned to a vehicle.", { assignedDriverId: "Driver is inactive" });
  return driver;
}

/**
 * Links a driver to a vehicle (one-to-one). If the driver currently has another
 * vehicle, that link is released first so the pairing simply moves.
 */
export async function setVehicleDriver(db: Db, actor: SessionUser | null, vehicleId: string, driverId: string | null) {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, include: { assignedDriver: true } });
  if (!vehicle) throw notFound("Vehicle");
  if (vehicle.assignedDriverId === driverId) return vehicle;

  if (driverId) {
    const driver = await assertDriverAssignable(db, driverId);
    const previous = await db.vehicle.findFirst({ where: { assignedDriverId: driverId, NOT: { id: vehicleId } } });
    if (previous) {
      await db.vehicle.update({ where: { id: previous.id }, data: { assignedDriverId: null } });
      await logActivity(db, actor, "UNASSIGN", "Vehicle", previous.id, `Released ${driver.fullName} from ${previous.registrationNumber}`);
    }
    await db.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: driverId } });
    await logActivity(db, actor, "ASSIGN", "Vehicle", vehicleId, `Assigned driver ${driver.fullName} to ${vehicle.registrationNumber}`);
    await logActivity(db, actor, "ASSIGN", "Driver", driverId, `Assigned vehicle ${vehicle.registrationNumber} to ${driver.fullName}`);
  } else {
    await db.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: null } });
    await logActivity(
      db, actor, "UNASSIGN", "Vehicle", vehicleId,
      `Released ${vehicle.assignedDriver?.fullName ?? "driver"} from ${vehicle.registrationNumber}`,
    );
  }
  return db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
}

function toData(input: VehicleInput) {
  const { assignedDriverId: _driver, lastLat, lastLng, ...rest } = input;
  void _driver;
  return { ...rest, ...(lastLat != null && lastLng != null ? { lastLat, lastLng } : {}) };
}

/** Inserts a vehicle inside an existing transaction (shared by the form and CSV import). */
export async function insertVehicle(tx: Db, actor: SessionUser, input: VehicleInput, opts: { quiet?: boolean } = {}) {
  const code = await nextCode(tx, "vehicle", "VEH");
  const data = toData(input);
  const vehicle = await tx.vehicle.create({
    data: { ...data, code, ...(data.lastLat != null ? { lastLocationAt: new Date() } : {}) },
  });
  if (!opts.quiet) await logActivity(tx, actor, "CREATE", "Vehicle", vehicle.id, `Added vehicle ${vehicle.registrationNumber} (${vehicle.name})`);
  if (input.assignedDriverId) await setVehicleDriver(tx, actor, vehicle.id, input.assignedDriverId);
  return vehicle;
}

export async function createVehicle(actor: SessionUser, input: VehicleInput) {
  return prisma.$transaction(async (tx) => {
    const vehicle = await insertVehicle(tx, actor, input);
    return tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: { assignedDriver: driverSummary } });
  });
}

export async function updateVehicle(actor: SessionUser, id: string, input: VehicleInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw notFound("Vehicle");

    const data = toData(input);
    let status: string = data.status;
    if (existing.status === "ON_DELIVERY") {
      // The delivery workflow owns the status while the vehicle is out on a job.
      if (input.status !== "AVAILABLE") {
        throw conflict("This vehicle is on a delivery. Complete or reassign the delivery before changing its status.", {
          status: "Vehicle is currently on a delivery",
        });
      }
      status = "ON_DELIVERY";
    }
    if (input.odometer < existing.odometer) {
      const lastFuel = await tx.fuelRecord.findFirst({ where: { vehicleId: id }, orderBy: { odometer: "desc" } });
      if (lastFuel && input.odometer < lastFuel.odometer) {
        throw conflict("Odometer cannot be lower than the latest fuel record.", {
          odometer: `Latest fuel record is at ${lastFuel.odometer.toLocaleString("en-IN")} km`,
        });
      }
    }

    const vehicle = await tx.vehicle.update({ where: { id }, data: { ...data, status } });
    await logActivity(tx, actor, "UPDATE", "Vehicle", id, `Updated vehicle ${vehicle.registrationNumber}`);

    if (existing.status !== status) {
      await logActivity(tx, actor, "STATUS_CHANGE", "Vehicle", id, `${vehicle.registrationNumber}: ${humanize(existing.status)} → ${humanize(status)}`);
      await notifyRoles(tx, FLEET_ROLES, {
        category: "VEHICLE",
        severity: status === "AVAILABLE" ? "SUCCESS" : "WARNING",
        title: `Vehicle ${humanize(status).toLowerCase()}`,
        message: `${vehicle.registrationNumber} (${vehicle.name}) changed from ${humanize(existing.status)} to ${humanize(status)}.`,
        entityType: "Vehicle",
        entityId: id,
      });
    }
    await setVehicleDriver(tx, actor, id, input.assignedDriverId);
    return tx.vehicle.findUniqueOrThrow({ where: { id }, include: { assignedDriver: driverSummary } });
  });
}

/**
 * Vehicles are archived (soft-deleted) so historical deliveries, fuel and
 * maintenance records keep a valid reference.
 */
export async function deleteVehicle(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!vehicle) throw notFound("Vehicle");
    const active = await tx.delivery.count({ where: { vehicleId: id, status: { in: ACTIVE_DELIVERY_STATUSES } } });
    if (active > 0) {
      throw conflict(`This vehicle has ${active} active deliver${active === 1 ? "y" : "ies"}. Complete or reassign ${active === 1 ? "it" : "them"} first.`);
    }
    await tx.vehicle.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE", assignedDriverId: null } });
    await logActivity(tx, actor, "DELETE", "Vehicle", id, `Removed vehicle ${vehicle.registrationNumber} (${vehicle.name})`);
    return { id };
  });
}
