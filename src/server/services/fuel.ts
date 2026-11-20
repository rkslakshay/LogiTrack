import type { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { nextCode, prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { conflict, notFound } from "@/lib/errors";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { dateRange, orderBy, paged, type ListQuery } from "@/lib/list";
import type { FuelInput } from "@/lib/validation";
import { computeFuelStats, fuelTotalPaise, validateOdometer } from "@/lib/domain/fuel";
import { logActivity } from "./activity";

const SORTABLE = ["code", "date", "quantityL", "totalCostPaise", "odometer", "station", "pricePerLitrePaise"] as const;
const vehicleSummary = { select: { id: true, registrationNumber: true, name: true, fuelType: true } } as const;

function whereFor(list: ListQuery, filters: { vehicleId?: string | null }): Prisma.FuelRecordWhereInput {
  return {
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(dateRange(list) ? { date: dateRange(list) } : {}),
    ...(list.q
      ? {
          OR: [
            { station: { contains: list.q } },
            { code: { contains: list.q } },
            { notes: { contains: list.q } },
            { vehicle: { registrationNumber: { contains: list.q } } },
          ],
        }
      : {}),
  };
}

export async function listFuel(list: ListQuery, filters: { vehicleId?: string | null }) {
  const where = whereFor(list, filters);
  const [items, total] = await Promise.all([
    prisma.fuelRecord.findMany({
      where,
      include: { vehicle: vehicleSummary },
      orderBy: orderBy(list, SORTABLE, { date: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.fuelRecord.count({ where }),
  ]);
  return paged(items, total, list);
}

async function validate(db: Db, input: FuelInput, excludeId?: string) {
  const vehicle = await db.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
  if (!vehicle) throw notFound("Vehicle");
  if (vehicle.fuelType !== "ELECTRIC" && input.quantityL > vehicle.fuelCapacity * 1.05) {
    throw conflict(`Quantity exceeds the tank capacity of ${vehicle.registrationNumber} (${vehicle.fuelCapacity} L).`, {
      quantityL: `Tank capacity is ${vehicle.fuelCapacity} L`,
    });
  }
  const others = await db.fuelRecord.findMany({
    where: { vehicleId: input.vehicleId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { date: true, odometer: true },
  });
  const problem = validateOdometer(input.odometer, input.date, others);
  if (problem) throw conflict(problem, { odometer: problem });
  return vehicle;
}

function toData(input: FuelInput) {
  const pricePerLitrePaise = rupeesToPaise(input.pricePerLitre);
  return {
    vehicleId: input.vehicleId,
    date: input.date,
    quantityL: input.quantityL,
    pricePerLitrePaise,
    totalCostPaise: fuelTotalPaise(input.quantityL, pricePerLitrePaise),
    odometer: input.odometer,
    station: input.station,
    notes: input.notes,
  };
}

export async function createFuel(actor: SessionUser, input: FuelInput) {
  return prisma.$transaction((tx) => insertFuel(tx, actor, input));
}

/** Inserts a fuel record inside an existing transaction (shared by the form and CSV import). */
export async function insertFuel(tx: Db, actor: SessionUser, input: FuelInput, opts: { quiet?: boolean } = {}) {
  {
    const vehicle = await validate(tx, input);
    const code = await nextCode(tx, "fuel", "FUEL");
    const record = await tx.fuelRecord.create({ data: { ...toData(input), code, createdById: actor.id }, include: { vehicle: vehicleSummary } });
    // A newer reading than the vehicle's odometer is, by definition, the latest truth.
    if (input.odometer > vehicle.odometer) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometer: input.odometer } });
    if (!opts.quiet) await logActivity(tx, actor, "CREATE", "FuelRecord", record.id, `Logged ${input.quantityL} L of fuel for ${vehicle.registrationNumber} (${formatINR(record.totalCostPaise)})`);
    return record;
  }
}

export async function updateFuel(actor: SessionUser, id: string, input: FuelInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.fuelRecord.findUnique({ where: { id } });
    if (!existing) throw notFound("Fuel record");
    const vehicle = await validate(tx, input, id);
    const record = await tx.fuelRecord.update({ where: { id }, data: toData(input), include: { vehicle: vehicleSummary } });
    if (input.odometer > vehicle.odometer) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometer: input.odometer } });
    await logActivity(tx, actor, "UPDATE", "FuelRecord", id, `Updated fuel record ${existing.code} for ${vehicle.registrationNumber}`);
    return record;
  });
}

export async function deleteFuel(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.fuelRecord.findUnique({ where: { id }, include: { vehicle: true } });
    if (!existing) throw notFound("Fuel record");
    await tx.fuelRecord.delete({ where: { id } });
    await logActivity(tx, actor, "DELETE", "FuelRecord", id, `Deleted fuel record ${existing.code} for ${existing.vehicle.registrationNumber}`);
    return { id };
  });
}

/** Fuel analytics for the selected period, computed from saved records only. */
export async function fuelSummary(list: ListQuery, filters: { vehicleId?: string | null }) {
  const records = await prisma.fuelRecord.findMany({
    where: whereFor({ ...list, q: "" }, filters),
    include: { vehicle: vehicleSummary },
    orderBy: { date: "asc" },
  });

  const byVehicle = new Map<string, typeof records>();
  for (const r of records) {
    const bucket = byVehicle.get(r.vehicleId) ?? [];
    bucket.push(r);
    byVehicle.set(r.vehicleId, bucket);
  }
  const vehicles = [...byVehicle.values()]
    .map((rows) => ({ vehicle: rows[0].vehicle, ...computeFuelStats(rows) }))
    .sort((a, b) => b.totalCostPaise - a.totalCostPaise);

  // Fleet mileage aggregates per-vehicle distances (odometers are not comparable across vehicles).
  const measured = vehicles.filter((v) => v.mileageKmPerL != null);
  const distanceKm = measured.reduce((s, v) => s + v.distanceKm, 0);
  const litresForDistance = measured.reduce((s, v) => s + v.distanceKm / v.mileageKmPerL!, 0);
  const costForDistance = measured.reduce((s, v) => s + (v.costPerKmPaise ?? 0) * v.distanceKm, 0);

  const monthly = new Map<string, { month: string; label: string; costPaise: number; litres: number }>();
  for (const r of records) {
    const key = format(r.date, "yyyy-MM");
    const row = monthly.get(key) ?? { month: key, label: format(r.date, "MMM yy"), costPaise: 0, litres: 0 };
    row.costPaise += r.totalCostPaise;
    row.litres += r.quantityL;
    monthly.set(key, row);
  }

  const totalLitres = records.reduce((s, r) => s + r.quantityL, 0);
  const totalCostPaise = records.reduce((s, r) => s + r.totalCostPaise, 0);
  return {
    totals: {
      fillCount: records.length,
      totalLitres: Math.round(totalLitres * 10) / 10,
      totalCostPaise,
      avgPricePerLitrePaise: totalLitres > 0 ? Math.round(totalCostPaise / totalLitres) : null,
      distanceKm,
      mileageKmPerL: litresForDistance > 0 ? distanceKm / litresForDistance : null,
      costPerKmPaise: distanceKm > 0 ? costForDistance / distanceKm : null,
    },
    vehicles,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, litres: Math.round(m.litres * 10) / 10 })),
  };
}
