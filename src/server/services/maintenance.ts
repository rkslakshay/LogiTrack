import type { Prisma } from "@prisma/client";
import { nextCode, prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { MAINTENANCE_TYPE_LABELS, type MaintenanceType } from "@/lib/constants";
import { conflict, notFound } from "@/lib/errors";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { dateRange, orderBy, paged, type ListQuery } from "@/lib/list";
import type { MaintenanceInput } from "@/lib/validation";
import { expiryReminder, maintenanceReminder, type ReminderState } from "@/lib/domain/reminders";
import { logActivity } from "./activity";
import { FLEET_ROLES, notifyRoles } from "./notifications";
import { getSettings } from "./settings";

const SORTABLE = ["code", "serviceDate", "type", "status", "costPaise", "nextServiceDate", "provider"] as const;
const vehicleSummary = { select: { id: true, registrationNumber: true, name: true, status: true, odometer: true } } as const;
const label = (type: string) => MAINTENANCE_TYPE_LABELS[type as MaintenanceType] ?? type;

export async function listMaintenance(list: ListQuery, filters: { vehicleId?: string | null; status?: string | null; type?: string | null }) {
  const where: Prisma.MaintenanceRecordWhereInput = {
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(dateRange(list) ? { serviceDate: dateRange(list) } : {}),
    ...(list.q
      ? {
          OR: [
            { description: { contains: list.q } },
            { provider: { contains: list.q } },
            { code: { contains: list.q } },
            { vehicle: { registrationNumber: { contains: list.q } } },
          ],
        }
      : {}),
  };
  const [items, total, cost] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      include: { vehicle: vehicleSummary },
      orderBy: orderBy(list, SORTABLE, { serviceDate: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.maintenanceRecord.count({ where }),
    prisma.maintenanceRecord.aggregate({ where: { ...where, status: "COMPLETED" }, _sum: { costPaise: true }, _count: true }),
  ]);
  return { ...paged(items, total, list), completedCostPaise: cost._sum.costPaise ?? 0, completedCount: cost._count };
}

/**
 * A vehicle is held in MAINTENANCE while any job on it is IN_PROGRESS and is
 * returned to AVAILABLE when the last such job is completed or cancelled.
 */
async function syncVehicleStatus(db: Db, actor: SessionUser | null, vehicleId: string) {
  const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.deletedAt) return;
  const open = await db.maintenanceRecord.count({ where: { vehicleId, status: "IN_PROGRESS" } });
  let next: string | null = null;
  if (open > 0 && vehicle.status === "AVAILABLE") next = "MAINTENANCE";
  if (open === 0 && vehicle.status === "MAINTENANCE") next = "AVAILABLE";
  if (!next) return;
  await db.vehicle.update({ where: { id: vehicleId }, data: { status: next } });
  await logActivity(db, actor, "STATUS_CHANGE", "Vehicle", vehicleId, `${vehicle.registrationNumber}: ${next === "MAINTENANCE" ? "moved to maintenance" : "returned to service"}`);
  await notifyRoles(db, [...FLEET_ROLES, "DISPATCHER"], {
    category: "VEHICLE",
    severity: next === "MAINTENANCE" ? "WARNING" : "SUCCESS",
    title: next === "MAINTENANCE" ? "Vehicle under maintenance" : "Vehicle back in service",
    message:
      next === "MAINTENANCE"
        ? `${vehicle.registrationNumber} is now under maintenance and unavailable for deliveries.`
        : `${vehicle.registrationNumber} has completed maintenance and is available again.`,
    entityType: "Vehicle",
    entityId: vehicleId,
  });
}

async function assertCanStart(db: Db, vehicleId: string) {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
  if (!vehicle) throw notFound("Vehicle");
  if (vehicle.status === "ON_DELIVERY") {
    throw conflict(`${vehicle.registrationNumber} is on a delivery. Maintenance can start once the delivery is complete.`, {
      status: "Vehicle is currently on a delivery",
    });
  }
  return vehicle;
}

function toData(input: MaintenanceInput) {
  const { cost, ...rest } = input;
  return { ...rest, costPaise: rupeesToPaise(cost) };
}

export async function createMaintenance(actor: SessionUser, input: MaintenanceInput) {
  return prisma.$transaction((tx) => insertMaintenance(tx, actor, input));
}

/** Inserts a maintenance record inside an existing transaction (shared by the form and CSV import). */
export async function insertMaintenance(tx: Db, actor: SessionUser, input: MaintenanceInput, opts: { quiet?: boolean; completedAt?: Date } = {}) {
  {
    const vehicle = input.status === "IN_PROGRESS"
      ? await assertCanStart(tx, input.vehicleId)
      : await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
    if (!vehicle) throw notFound("Vehicle");
    const code = await nextCode(tx, "maintenance", "MNT");
    const record = await tx.maintenanceRecord.create({
      data: { ...toData(input), code, completedAt: input.status === "COMPLETED" ? (opts.completedAt ?? new Date()) : null },
      include: { vehicle: vehicleSummary },
    });
    if (!opts.quiet) await logActivity(tx, actor, "CREATE", "MaintenanceRecord", record.id, `Scheduled ${label(input.type)} for ${vehicle.registrationNumber} (${code})`);
    await syncVehicleStatus(tx, actor, input.vehicleId);
    return record;
  }
}

export async function updateMaintenance(actor: SessionUser, id: string, input: MaintenanceInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id } });
    if (!existing) throw notFound("Maintenance record");
    if (input.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS") await assertCanStart(tx, input.vehicleId);
    const record = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        ...toData(input),
        completedAt: input.status === "COMPLETED" ? (existing.completedAt ?? new Date()) : null,
      },
      include: { vehicle: vehicleSummary },
    });
    await logActivity(tx, actor, "UPDATE", "MaintenanceRecord", id, `Updated maintenance ${existing.code} for ${record.vehicle.registrationNumber}`);
    await syncVehicleStatus(tx, actor, existing.vehicleId);
    if (existing.vehicleId !== input.vehicleId) await syncVehicleStatus(tx, actor, input.vehicleId);
    return record;
  });
}

export async function startMaintenance(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id } });
    if (!existing) throw notFound("Maintenance record");
    if (existing.status !== "SCHEDULED") throw conflict("Only scheduled maintenance can be started.");
    const vehicle = await assertCanStart(tx, existing.vehicleId);
    const record = await tx.maintenanceRecord.update({ where: { id }, data: { status: "IN_PROGRESS" }, include: { vehicle: vehicleSummary } });
    await logActivity(tx, actor, "STATUS_CHANGE", "MaintenanceRecord", id, `Started ${label(existing.type)} on ${vehicle.registrationNumber} (${existing.code})`);
    await syncVehicleStatus(tx, actor, existing.vehicleId);
    return record;
  });
}

export async function completeMaintenance(
  actor: SessionUser,
  id: string,
  input: { cost: number; odometer: number | null; nextServiceDate: Date | null; nextServiceOdometer: number | null },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id }, include: { vehicle: true } });
    if (!existing) throw notFound("Maintenance record");
    if (existing.status === "COMPLETED") throw conflict("This maintenance job is already completed.");
    if (existing.status === "CANCELLED") throw conflict("A cancelled maintenance job cannot be completed.");
    const odometer = input.odometer ?? existing.odometer ?? existing.vehicle.odometer;
    if (input.nextServiceOdometer != null && input.nextServiceOdometer <= odometer) {
      throw conflict("Next service odometer must be greater than the current reading.", {
        nextServiceOdometer: `Must be above ${odometer.toLocaleString("en-IN")} km`,
      });
    }
    const now = new Date();
    if (input.nextServiceDate && input.nextServiceDate <= now) {
      throw conflict("Next service date must be in the future.", { nextServiceDate: "Must be a future date" });
    }
    const record = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        costPaise: rupeesToPaise(input.cost),
        odometer,
        nextServiceDate: input.nextServiceDate,
        nextServiceOdometer: input.nextServiceOdometer,
      },
      include: { vehicle: vehicleSummary },
    });
    if (odometer > existing.vehicle.odometer) await tx.vehicle.update({ where: { id: existing.vehicleId }, data: { odometer } });
    await logActivity(
      tx, actor, "COMPLETE", "MaintenanceRecord", id,
      `Completed ${label(existing.type)} on ${existing.vehicle.registrationNumber} (${existing.code}, ${formatINR(record.costPaise)})`,
    );
    await syncVehicleStatus(tx, actor, existing.vehicleId);
    return record;
  });
}

export async function cancelMaintenance(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id }, include: { vehicle: true } });
    if (!existing) throw notFound("Maintenance record");
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") throw conflict("This maintenance job is already closed.");
    const record = await tx.maintenanceRecord.update({ where: { id }, data: { status: "CANCELLED" }, include: { vehicle: vehicleSummary } });
    await logActivity(tx, actor, "STATUS_CHANGE", "MaintenanceRecord", id, `Cancelled ${label(existing.type)} on ${existing.vehicle.registrationNumber} (${existing.code})`);
    await syncVehicleStatus(tx, actor, existing.vehicleId);
    return record;
  });
}

export async function deleteMaintenance(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id }, include: { vehicle: true } });
    if (!existing) throw notFound("Maintenance record");
    if (existing.status === "COMPLETED") throw conflict("Completed maintenance is part of the service history and cannot be deleted.");
    await tx.maintenanceRecord.delete({ where: { id } });
    await logActivity(tx, actor, "DELETE", "MaintenanceRecord", id, `Deleted maintenance ${existing.code} for ${existing.vehicle.registrationNumber}`);
    await syncVehicleStatus(tx, actor, existing.vehicleId);
    return { id };
  });
}

// --- Reminders ------------------------------------------------------------------

export interface MaintenanceAlert {
  id: string;
  recordId: string;
  code: string;
  vehicleId: string;
  registrationNumber: string;
  vehicleName: string;
  type: string;
  typeLabel: string;
  state: Exclude<ReminderState, "OK">;
  reason: string;
  dueDate: Date | null;
  followUp: boolean;
}

/** Upcoming and overdue maintenance, from service dates and odometer thresholds. */
export async function maintenanceAlerts(now = new Date()): Promise<MaintenanceAlert[]> {
  const settings = await getSettings();
  // Only the columns the reminder rules need, and each vehicle once (not once per record):
  // about 3x faster with 1,000 records (docs/PERFORMANCE_REPORT.md).
  const [rows, vehicles] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where: { status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] } },
      select: { id: true, code: true, vehicleId: true, type: true, status: true, serviceDate: true, nextServiceDate: true, nextServiceOdometer: true },
      orderBy: { serviceDate: "desc" },
    }),
    prisma.vehicle.findMany({ where: { deletedAt: null }, select: vehicleSummary.select }),
  ]);
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const records = rows.flatMap((r) => {
    const vehicle = byId.get(r.vehicleId);
    return vehicle ? [{ ...r, vehicle }] : [];
  });
  const alerts: MaintenanceAlert[] = [];
  const seenFollowUp = new Set<string>();
  const openTypes = new Set(records.filter((r) => r.status !== "COMPLETED").map((r) => `${r.vehicleId}:${r.type}`));

  for (const r of records) {
    const key = `${r.vehicleId}:${r.type}`;
    if (r.status === "COMPLETED") {
      // Only the latest completed job per vehicle+type produces a follow-up, and
      // not when the follow-up has already been booked as a new job.
      if (seenFollowUp.has(key)) continue;
      seenFollowUp.add(key);
      if (openTypes.has(key)) continue;
    }
    const result = maintenanceReminder(r, r.vehicle.odometer, {
      now, days: settings.maintenanceReminderDays, km: settings.maintenanceReminderKm,
    });
    if (result.state === "OK" || !result.reason) continue;
    alerts.push({
      id: `${r.id}:${result.state}`,
      recordId: r.id,
      code: r.code,
      vehicleId: r.vehicleId,
      registrationNumber: r.vehicle.registrationNumber,
      vehicleName: r.vehicle.name,
      type: r.type,
      typeLabel: label(r.type),
      state: result.state,
      reason: result.reason,
      dueDate: result.dueDate,
      followUp: r.status === "COMPLETED",
    });
  }
  return alerts.sort((a, b) => (a.state === b.state ? +(a.dueDate ?? 0) - +(b.dueDate ?? 0) : a.state === "OVERDUE" ? -1 : 1));
}

export interface ComplianceAlert {
  id: string;
  kind: "INSURANCE" | "REGISTRATION" | "LICENSE";
  entityType: "Vehicle" | "Driver";
  entityId: string;
  subject: string;
  state: Exclude<ReminderState, "OK">;
  days: number;
  expiry: Date;
  userId?: string | null;
}

/** Insurance, registration and driving-licence expiries inside the reminder window. */
export async function complianceAlerts(now = new Date()): Promise<ComplianceAlert[]> {
  const settings = await getSettings();
  const opts = { now, days: settings.complianceReminderDays };
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: { deletedAt: null, status: { not: "INACTIVE" } } }),
    prisma.driver.findMany({ where: { deletedAt: null, status: { not: "INACTIVE" } } }),
  ]);
  const alerts: ComplianceAlert[] = [];
  for (const v of vehicles) {
    for (const [kind, expiry] of [["INSURANCE", v.insuranceExpiry], ["REGISTRATION", v.registrationExpiry]] as const) {
      const r = expiryReminder(expiry, opts);
      if (r.state !== "OK") {
        alerts.push({ id: `${kind}:${v.id}`, kind, entityType: "Vehicle", entityId: v.id, subject: `${v.registrationNumber} (${v.name})`, state: r.state, days: r.days, expiry });
      }
    }
  }
  for (const d of drivers) {
    const r = expiryReminder(d.licenseExpiry, opts);
    if (r.state !== "OK") {
      alerts.push({ id: `LICENSE:${d.id}`, kind: "LICENSE", entityType: "Driver", entityId: d.id, subject: d.fullName, state: r.state, days: r.days, expiry: d.licenseExpiry, userId: d.userId });
    }
  }
  return alerts.sort((a, b) => a.days - b.days);
}
