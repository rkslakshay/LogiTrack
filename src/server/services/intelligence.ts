import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { FUEL_TYPE_LABELS, VEHICLE_TYPE_LABELS, type FuelType, type VehicleType } from "@/lib/constants";
import { analyzeFuel, fuelTrend, type FuelVehicleInput } from "@/lib/domain/fuel-intel";
import { averageDailyKm, recommendService, ROUTINE_TYPES, SERVICE_INTERVALS } from "@/lib/domain/maintenance-intel";
import { assessRisk, compareRisk, historyFactor, RISK_RULES, type RiskAssessment } from "@/lib/domain/risk";
import { computeUtilization, UTILIZATION_RULES } from "@/lib/domain/utilization";
import { getSettings } from "./settings";

// Intelligence services: they load records, hand them to the pure rule engines
// in src/lib/domain and attach display names. Nothing here writes to the database.

type Range = { from: Date; to: Date };

// --- Fleet utilisation ------------------------------------------------------------

export async function fleetIntelligence(range: Range) {
  const [vehicles, deliveries, maintenance] = await Promise.all([
    prisma.vehicle.findMany({
      where: { deletedAt: null },
      select: { id: true, registrationNumber: true, name: true, type: true, status: true, createdAt: true, assignedDriver: { select: { fullName: true } } },
    }),
    prisma.delivery.findMany({
      where: { vehicleId: { not: null }, scheduledAt: { gte: range.from, lte: range.to } },
      select: { vehicleId: true, status: true, scheduledAt: true, distanceKm: true },
    }),
    prisma.maintenanceRecord.findMany({
      where: { status: { in: ["IN_PROGRESS", "COMPLETED"] }, serviceDate: { lte: range.to } },
      select: { vehicleId: true, status: true, serviceDate: true, completedAt: true },
    }),
  ]);
  const result = computeUtilization(
    vehicles.map((v) => ({ id: v.id, status: v.status, createdAt: v.createdAt, hasDriver: !!v.assignedDriver })),
    deliveries,
    maintenance,
    range,
  );
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return {
    range,
    rules: UTILIZATION_RULES,
    fleet: result.fleet,
    trend: result.trend,
    vehicles: result.vehicles.map((row) => {
      const v = byId.get(row.vehicleId)!;
      return {
        ...row,
        registrationNumber: v.registrationNumber,
        name: v.name,
        type: v.type,
        typeLabel: VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type,
        status: v.status,
        driver: v.assignedDriver?.fullName ?? null,
      };
    }),
  };
}

// --- Fuel efficiency --------------------------------------------------------------

export async function fuelIntelligence(range: Range) {
  const [vehicles, records] = await Promise.all([
    prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, registrationNumber: true, name: true, type: true, fuelType: true, status: true } }),
    prisma.fuelRecord.findMany({
      where: { date: { gte: range.from, lte: range.to } },
      select: { vehicleId: true, date: true, quantityL: true, totalCostPaise: true, odometer: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const fillsBy = new Map<string, typeof records>();
  for (const r of records) fillsBy.set(r.vehicleId, [...(fillsBy.get(r.vehicleId) ?? []), r]);

  // Electric vehicles do not buy fuel by the litre: they are listed separately, never judged.
  const combustion = vehicles.filter((v) => v.fuelType !== "ELECTRIC" && v.status !== "INACTIVE");
  const lastFill = new Map(combustion.map((v) => [v.id, (fillsBy.get(v.id) ?? []).at(-1)?.date ?? null]));
  const since = await Promise.all(
    combustion.map((v) => {
      const last = lastFill.get(v.id);
      return last ? prisma.delivery.count({ where: { vehicleId: v.id, status: "DELIVERED", deliveredAt: { gt: last } } }) : Promise.resolve(0);
    }),
  );

  const inputs: FuelVehicleInput[] = combustion.map((v, i) => ({
    vehicleId: v.id,
    group: `${v.type}:${v.fuelType}`,
    fills: fillsBy.get(v.id) ?? [],
    deliveriesSinceLastFill: since[i],
  }));
  const results = analyzeFuel(inputs);
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const rows = results
    .map((r) => {
      const v = byId.get(r.vehicleId)!;
      return {
        ...r,
        registrationNumber: v.registrationNumber,
        name: v.name,
        groupLabel: `${VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type} · ${FUEL_TYPE_LABELS[v.fuelType as FuelType] ?? v.fuelType}`,
      };
    })
    .sort((a, b) => b.flags.length - a.flags.length || (a.mileageKmPerL ?? Infinity) - (b.mileageKmPerL ?? Infinity));

  const flagged = (code: string) => rows.filter((r) => r.flags.some((f) => f.code === code)).length;
  const measured = rows.filter((r) => r.mileageKmPerL != null);
  const km = measured.reduce((s, r) => s + r.intervals.reduce((x, i) => x + i.km, 0), 0);
  const litres = measured.reduce((s, r) => s + r.intervals.reduce((x, i) => x + i.litres, 0), 0);
  return {
    range,
    summary: {
      vehiclesAnalysed: rows.length,
      vehiclesMeasured: measured.length,
      fleetMileageKmPerL: litres > 0 ? km / litres : null,
      poorMileage: flagged("POOR_MILEAGE"),
      mileageDrops: flagged("MILEAGE_DROP"),
      highCost: flagged("HIGH_COST"),
      incomplete: rows.filter((r) => r.flags.some((f) => ["INSUFFICIENT_DATA", "STALE_RECORDS", "SUSPECT_RECORD"].includes(f.code))).length,
      totalCostPaise: rows.reduce((s, r) => s + r.totalCostPaise, 0),
    },
    vehicles: rows.map(({ intervals, ...rest }) => ({
      ...rest,
      intervalCount: intervals.length,
      // Compact series for the per-vehicle mileage sparkline.
      series: intervals.map((i) => ({ date: i.date, kmPerL: Math.round(i.kmPerL * 10) / 10 })),
    })),
    trend: fuelTrend(inputs),
    electric: vehicles.filter((v) => v.fuelType === "ELECTRIC").map((v) => ({ id: v.id, registrationNumber: v.registrationNumber, name: v.name })),
  };
}

// --- Maintenance recommendations ---------------------------------------------------

export async function maintenanceIntelligence(now = new Date()) {
  const [vehicles, routine, fuel, delivered] = await Promise.all([
    prisma.vehicle.findMany({
      where: { deletedAt: null, status: { not: "INACTIVE" } },
      select: { id: true, registrationNumber: true, name: true, type: true, odometer: true, status: true },
    }),
    prisma.maintenanceRecord.findMany({
      where: { type: { in: ROUTINE_TYPES }, status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] } },
      select: { vehicleId: true, status: true, serviceDate: true, completedAt: true, odometer: true, nextServiceDate: true, nextServiceOdometer: true },
      orderBy: { serviceDate: "desc" },
    }),
    prisma.fuelRecord.findMany({ where: { date: { gte: subDays(now, 90) } }, select: { vehicleId: true, date: true, odometer: true } }),
    prisma.delivery.groupBy({
      by: ["vehicleId"],
      where: { status: "DELIVERED", deliveredAt: { gte: subDays(now, 60) }, vehicleId: { not: null } },
      _sum: { distanceKm: true },
    }),
  ]);

  const recommendations = [];
  for (const v of vehicles) {
    const own = routine.filter((r) => r.vehicleId === v.id);
    const last = own.find((r) => r.status === "COMPLETED");
    // Usage: prefer odometer readings from fuel records; fall back to delivered distance.
    const readings = [...fuel.filter((f) => f.vehicleId === v.id).map((f) => ({ date: f.date, odometer: f.odometer })), { date: now, odometer: v.odometer }];
    const deliveredKm = delivered.find((d) => d.vehicleId === v.id)?._sum.distanceKm ?? 0;
    const avgDailyKm = averageDailyKm(readings) ?? (deliveredKm > 0 ? deliveredKm / 60 : null);

    const rec = recommendService(
      {
        vehicleId: v.id,
        type: v.type,
        odometer: v.odometer,
        lastService: last ? { date: last.completedAt ?? last.serviceDate, odometer: last.odometer } : null,
        hasOpenRoutineJob: own.some((r) => r.status === "SCHEDULED" || r.status === "IN_PROGRESS"),
        followUpPlanned: !!last && (last.nextServiceDate != null || last.nextServiceOdometer != null),
        avgDailyKm,
      },
      now,
    );
    if (rec) {
      recommendations.push({
        ...rec,
        registrationNumber: v.registrationNumber,
        name: v.name,
        typeLabel: VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type,
        odometer: v.odometer,
        avgDailyKm: avgDailyKm == null ? null : Math.round(avgDailyKm),
      });
    }
  }
  const order = { OVERDUE: 0, SOON: 1, PLANNED: 2 } as const;
  recommendations.sort((a, b) => order[a.urgency] - order[b.urgency] || (a.dueInDays ?? 0) - (b.dueInDays ?? 0));
  return { recommendations, intervals: SERVICE_INTERVALS };
}

// --- Delivery risk ----------------------------------------------------------------

interface RiskDelivery {
  id: string;
  status: string;
  scheduledAt: Date;
  expectedAt: Date;
  pickedUpAt: Date | null;
  progress: number;
  distanceKm: number;
  driverId: string | null;
  vehicleId: string | null;
}

const OPEN_STATUSES = ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"];

/** Risk assessment for each open delivery in the list (closed deliveries are skipped). */
export async function riskFor(deliveries: RiskDelivery[], now = new Date()): Promise<Map<string, RiskAssessment>> {
  const open = deliveries.filter((d) => OPEN_STATUSES.includes(d.status));
  const out = new Map<string, RiskAssessment>();
  if (open.length === 0) return out;

  const driverIds = [...new Set(open.map((d) => d.driverId).filter((id): id is string => !!id))];
  const [settings, history] = await Promise.all([
    getSettings(),
    // Recent completed work: fleet-wide for the duration factor, per driver for punctuality.
    prisma.delivery.findMany({
      where: { status: "DELIVERED", pickedUpAt: { not: null }, deliveredAt: { not: null } },
      select: { driverId: true, pickedUpAt: true, deliveredAt: true, expectedAt: true, estimatedMinutes: true },
      orderBy: { deliveredAt: "desc" },
      take: 300,
    }),
  ]);
  const sample = (rows: typeof history) =>
    rows.map((h) => ({ actualMinutes: (h.deliveredAt!.getTime() - h.pickedUpAt!.getTime()) / 60_000, estimatedMinutes: h.estimatedMinutes }));
  const fleetFactor = historyFactor(sample(history.slice(0, 60)));
  const perDriver = new Map(
    driverIds.map((id) => {
      const rows = history.filter((h) => h.driverId === id).slice(0, 10);
      return [
        id,
        {
          factor: rows.length >= 3 ? historyFactor(sample(rows)) : fleetFactor,
          onTimeRate: rows.length ? rows.filter((h) => h.deliveredAt! <= h.expectedAt).length / rows.length : null,
          sample: rows.length,
        },
      ] as const;
    }),
  );

  for (const d of open) {
    const driver = d.driverId ? perDriver.get(d.driverId) : undefined;
    const assessment = assessRisk(
      { status: d.status, scheduledAt: d.scheduledAt, expectedAt: d.expectedAt, pickedUpAt: d.pickedUpAt, progress: d.progress, distanceKm: d.distanceKm, hasCrew: !!d.driverId && !!d.vehicleId },
      {
        now,
        averageSpeedKmh: settings.averageSpeedKmh,
        // Vehicles are moved by the GPS simulator, which runs faster than real time.
        timeScale: settings.simulationSpeed,
        historyFactor: driver?.factor ?? fleetFactor,
        driverOnTimeRate: driver?.onTimeRate ?? null,
        driverSample: driver?.sample ?? 0,
      },
    );
    if (assessment) out.set(d.id, assessment);
  }
  return out;
}

/** Every open delivery with its risk, riskiest first. */
export async function riskOverview() {
  const deliveries = await prisma.delivery.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: {
      id: true, code: true, status: true, priority: true, customerName: true, destinationAddress: true, scheduledAt: true, expectedAt: true,
      pickedUpAt: true, progress: true, distanceKm: true, driverId: true, vehicleId: true,
      driver: { select: { fullName: true } }, vehicle: { select: { registrationNumber: true } },
    },
  });
  const risks = await riskFor(deliveries);
  const items = deliveries
    .map((d) => ({ ...d, risk: risks.get(d.id)! }))
    .filter((d) => d.risk)
    .sort((a, b) => compareRisk(a.risk.level, b.risk.level) || a.risk.slackMinutes - b.risk.slackMinutes);
  const count = (level: string) => items.filter((d) => d.risk.level === level).length;
  return { counts: { high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW"), total: items.length }, items, rules: RISK_RULES };
}
