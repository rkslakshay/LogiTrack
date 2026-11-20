import { addDays, addMonths, differenceInCalendarDays, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import {
  DELIVERY_STATUSES, MAINTENANCE_TYPE_LABELS, VEHICLE_STATUSES, VEHICLE_TYPES, VEHICLE_TYPE_LABELS, humanize, type MaintenanceType, type VehicleType,
} from "@/lib/constants";
import { comparisonRange, delta, isSignificant, type CompareMode, type Delta } from "@/lib/domain/compare";
import { can } from "@/lib/permissions";
import { computePerformance, rankByScore } from "@/lib/domain/performance";
import { complianceAlerts, maintenanceAlerts } from "./maintenance";

type Range = { from: Date; to: Date };

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

const deliverySelect = {
  id: true, code: true, status: true, scheduledAt: true, expectedAt: true, pickedUpAt: true, deliveredAt: true,
  distanceKm: true, driverId: true, vehicleId: true,
} as const;

/** Last `count` calendar months ending with the current month. */
function lastMonths(count: number, now = new Date()) {
  const start = startOfMonth(addMonths(now, -(count - 1)));
  return Array.from({ length: count }, (_, i) => {
    const d = addMonths(start, i);
    return { key: format(d, "yyyy-MM"), label: format(d, "MMM yy") };
  });
}

/** Picks day / week / month buckets depending on how long the range is. */
function buckets(range: Range) {
  const days = differenceInCalendarDays(range.to, range.from) + 1;
  const unit: "day" | "week" | "month" = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const keyOf = (d: Date) =>
    unit === "day" ? format(d, "yyyy-MM-dd") : unit === "week" ? format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") : format(d, "yyyy-MM");
  const labelOf = (d: Date) => (unit === "month" ? format(d, "MMM yy") : format(unit === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : d, "dd MMM"));
  const list: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (let d = startOfDay(range.from); d <= range.to; d = addDays(d, 1)) {
    const key = keyOf(d);
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ key, label: labelOf(d) });
    }
  }
  return { unit, keyOf, list };
}

function outcome(d: { status: string; deliveredAt: Date | null; expectedAt: Date }) {
  if (d.status === "DELIVERED") return d.deliveredAt && d.deliveredAt <= d.expectedAt ? "onTime" : "late";
  if (d.status === "FAILED") return "failed";
  return null;
}

// --- Dashboard ------------------------------------------------------------------

export async function getDashboard(user: SessionUser, range: Range) {
  const inRange = { gte: range.from, lte: range.to };
  const sixMonths = lastMonths(6);
  const sixMonthsStart = new Date(`${sixMonths[0].key}-01T00:00:00`);

  const [vehicles, drivers, activeDeliveries, pendingDeliveries, delayedNow, closedInRange, trendDeliveries, fuelInRange, fuelTrend, maintInRange, recentDeliveries, driverDeliveries] =
    await Promise.all([
      prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, type: true, status: true } }),
      prisma.driver.findMany({ where: { deletedAt: null }, select: { id: true, fullName: true, code: true, status: true } }),
      prisma.delivery.count({ where: { status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"] } } }),
      prisma.delivery.count({ where: { status: "PENDING" } }),
      prisma.delivery.count({ where: { status: "DELAYED" } }),
      prisma.delivery.findMany({ where: { closedAt: inRange, status: { in: ["DELIVERED", "FAILED"] } }, select: { ...deliverySelect, closedAt: true } }),
      prisma.delivery.findMany({ where: { scheduledAt: { gte: sixMonthsStart } }, select: { status: true, scheduledAt: true } }),
      prisma.fuelRecord.aggregate({ where: { date: inRange }, _sum: { totalCostPaise: true, quantityL: true } }),
      prisma.fuelRecord.findMany({ where: { date: { gte: sixMonthsStart } }, select: { date: true, totalCostPaise: true } }),
      prisma.maintenanceRecord.aggregate({ where: { status: "COMPLETED", serviceDate: inRange }, _sum: { costPaise: true } }),
      prisma.delivery.findMany({
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true, code: true, customerName: true, destinationAddress: true, status: true, priority: true, scheduledAt: true, updatedAt: true,
          driver: { select: { fullName: true } }, vehicle: { select: { registrationNumber: true } },
        },
      }),
      prisma.delivery.findMany({ where: { driverId: { not: null }, scheduledAt: inRange }, select: deliverySelect }),
    ]);

  const vCount = (s: string) => vehicles.filter((v) => v.status === s).length;
  const delivered = closedInRange.filter((d) => d.status === "DELIVERED");
  const lateInRange = delivered.filter((d) => outcome(d) === "late").length;

  // Delivery performance over the selected period.
  const b = buckets(range);
  const perf = new Map(b.list.map((x) => [x.key, { label: x.label, onTime: 0, late: 0, failed: 0 }]));
  for (const d of closedInRange) {
    const row = perf.get(b.keyOf(d.closedAt!));
    const o = outcome(d);
    if (row && o) row[o]++;
  }

  const trends = new Map(sixMonths.map((m) => [m.key, { label: m.label, total: 0, delivered: 0, failed: 0, cancelled: 0 }]));
  for (const d of trendDeliveries) {
    const row = trends.get(format(d.scheduledAt, "yyyy-MM"));
    if (!row) continue;
    row.total++;
    if (d.status === "DELIVERED") row.delivered++;
    else if (d.status === "FAILED") row.failed++;
    else if (d.status === "CANCELLED") row.cancelled++;
  }

  const fuelMonths = new Map(sixMonths.map((m) => [m.key, { label: m.label, costPaise: 0 }]));
  for (const f of fuelTrend) {
    const row = fuelMonths.get(format(f.date, "yyyy-MM"));
    if (row) row.costPaise += f.totalCostPaise;
  }

  const utilization = VEHICLE_TYPES.map((type) => {
    const ofType = vehicles.filter((v) => v.type === type);
    const onDelivery = ofType.filter((v) => v.status === "ON_DELIVERY").length;
    const operational = ofType.filter((v) => v.status !== "INACTIVE").length;
    return {
      type,
      label: VEHICLE_TYPE_LABELS[type as VehicleType],
      total: ofType.length,
      onDelivery,
      available: ofType.filter((v) => v.status === "AVAILABLE").length,
      maintenance: ofType.filter((v) => v.status === "MAINTENANCE").length,
      utilization: pct(onDelivery, operational) ?? 0,
    };
  }).filter((u) => u.total > 0);

  const ranked = rankByScore(
    drivers.map((driver) => ({ driver, stats: computePerformance(driverDeliveries.filter((d) => d.driverId === driver.id)) })),
  )
    .filter((r) => r.rank != null)
    .slice(0, 5)
    .map((r) => ({
      id: r.driver.id, name: r.driver.fullName, code: r.driver.code, rank: r.rank, score: r.stats.score,
      delivered: r.stats.delivered, onTimeRate: r.stats.onTimeRate,
    }));

  const canMaintenance = can(user.role, "maintenance:read");
  const [mAlerts, cAlerts, activity, notifications] = await Promise.all([
    canMaintenance ? maintenanceAlerts() : Promise.resolve(null),
    canMaintenance ? complianceAlerts() : Promise.resolve(null),
    can(user.role, "activity:read")
      ? prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } } } })
      : Promise.resolve(null),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  const operational = vehicles.filter((v) => v.status !== "INACTIVE").length;
  return {
    range: { from: range.from, to: range.to },
    kpis: {
      totalVehicles: vehicles.length,
      activeVehicles: vCount("ON_DELIVERY"),
      availableVehicles: vCount("AVAILABLE"),
      maintenanceVehicles: vCount("MAINTENANCE"),
      inactiveVehicles: vCount("INACTIVE"),
      fleetUtilization: pct(vCount("ON_DELIVERY"), operational) ?? 0,
      totalDrivers: drivers.length,
      availableDrivers: drivers.filter((d) => d.status === "AVAILABLE").length,
      onDeliveryDrivers: drivers.filter((d) => d.status === "ON_DELIVERY").length,
      activeDeliveries,
      pendingDeliveries,
      completedDeliveries: delivered.length,
      failedDeliveries: closedInRange.length - delivered.length,
      delayedDeliveries: delayedNow,
      lateDeliveries: lateInRange,
      onTimeRate: pct(delivered.length - lateInRange, delivered.length),
      totalDistanceKm: round1(delivered.reduce((s, d) => s + d.distanceKm, 0)),
      fuelCostPaise: can(user.role, "fuel:read") ? (fuelInRange._sum.totalCostPaise ?? 0) : null,
      fuelLitres: can(user.role, "fuel:read") ? round1(fuelInRange._sum.quantityL ?? 0) : null,
      maintenanceCostPaise: canMaintenance ? (maintInRange._sum.costPaise ?? 0) : null,
    },
    charts: {
      deliveryPerformance: [...perf.values()],
      performanceUnit: b.unit,
      monthlyTrends: [...trends.values()],
      fuelByMonth: can(user.role, "fuel:read") ? [...fuelMonths.values()].map((m) => ({ label: m.label, cost: Math.round(m.costPaise / 100) })) : null,
      fleetUtilization: utilization,
      vehicleStatus: VEHICLE_STATUSES.map((s) => ({ status: s, label: humanize(s), count: vCount(s) })).filter((s) => s.count > 0),
      topDrivers: ranked,
    },
    recentDeliveries,
    recentActivity: activity,
    maintenanceAlerts: mAlerts?.slice(0, 6) ?? null,
    maintenanceAlertCount: mAlerts?.length ?? 0,
    complianceAlerts: cAlerts?.slice(0, 6) ?? null,
    notifications,
  };
}

// --- Analytics ------------------------------------------------------------------

async function analyze(range: Range) {
  const inRange = { gte: range.from, lte: range.to };
  const [deliveries, fuel, maintenance, vehicles, drivers] = await Promise.all([
    prisma.delivery.findMany({ where: { scheduledAt: inRange }, select: deliverySelect }),
    prisma.fuelRecord.findMany({ where: { date: inRange }, select: { vehicleId: true, date: true, totalCostPaise: true, quantityL: true } }),
    prisma.maintenanceRecord.findMany({ where: { status: "COMPLETED", serviceDate: inRange }, select: { vehicleId: true, serviceDate: true, costPaise: true, type: true } }),
    prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, registrationNumber: true, name: true, type: true, status: true } }),
    prisma.driver.findMany({ where: { deletedAt: null }, select: { id: true, fullName: true, code: true } }),
  ]);

  const delivered = deliveries.filter((d) => d.status === "DELIVERED");
  const failed = deliveries.filter((d) => d.status === "FAILED");
  const onTime = delivered.filter((d) => outcome(d) === "onTime");
  const durations = delivered
    .filter((d) => d.pickedUpAt && d.deliveredAt)
    .map((d) => (+d.deliveredAt! - +d.pickedUpAt!) / 60_000)
    .filter((m) => m >= 0);
  const fuelCost = fuel.reduce((s, f) => s + f.totalCostPaise, 0);
  const maintCost = maintenance.reduce((s, m) => s + m.costPaise, 0);
  const usedVehicles = new Set(deliveries.filter((d) => d.vehicleId && d.status !== "PENDING" && d.status !== "CANCELLED").map((d) => d.vehicleId));
  const operational = vehicles.filter((v) => v.status !== "INACTIVE");

  const b = buckets(range);
  const timeline = new Map(
    b.list.map((x) => [x.key, { label: x.label, total: 0, delivered: 0, onTime: 0, late: 0, failed: 0, cancelled: 0, fuelCost: 0, maintenanceCost: 0 }]),
  );
  for (const d of deliveries) {
    const row = timeline.get(b.keyOf(d.scheduledAt));
    if (!row) continue;
    row.total++;
    const o = outcome(d);
    if (o) row[o]++;
    if (d.status === "DELIVERED") row.delivered++;
    if (d.status === "CANCELLED") row.cancelled++;
  }
  for (const f of fuel) {
    const row = timeline.get(b.keyOf(f.date));
    if (row) row.fuelCost += f.totalCostPaise / 100;
  }
  for (const m of maintenance) {
    const row = timeline.get(b.keyOf(m.serviceDate));
    if (row) row.maintenanceCost += m.costPaise / 100;
  }

  const vehicleRows = vehicles
    .map((v) => {
      const own = deliveries.filter((d) => d.vehicleId === v.id);
      const done = own.filter((d) => d.status === "DELIVERED");
      const activeDays = new Set(own.filter((d) => d.status !== "CANCELLED").map((d) => format(d.scheduledAt, "yyyy-MM-dd"))).size;
      const totalDays = differenceInCalendarDays(range.to, range.from) + 1;
      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        name: v.name,
        type: v.type,
        deliveries: own.length,
        delivered: done.length,
        distanceKm: round1(done.reduce((s, d) => s + d.distanceKm, 0)),
        fuelCostPaise: fuel.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.totalCostPaise, 0),
        maintenanceCostPaise: maintenance.filter((m) => m.vehicleId === v.id).reduce((s, m) => s + m.costPaise, 0),
        /** Share of days in the period on which the vehicle had at least one delivery. */
        utilization: pct(activeDays, totalDays) ?? 0,
      };
    })
    .sort((a, b2) => b2.delivered - a.delivered || b2.deliveries - a.deliveries);

  const driverRows = rankByScore(
    drivers.map((driver) => ({ driver, stats: computePerformance(deliveries.filter((d) => d.driverId === driver.id)) })),
  ).map((r) => ({
    id: r.driver.id, name: r.driver.fullName, code: r.driver.code, rank: r.rank, score: r.stats.score,
    delivered: r.stats.delivered, failed: r.stats.failed, onTime: r.stats.onTime, late: r.stats.late,
    onTimeRate: r.stats.onTimeRate, successRate: r.stats.successRate, distanceKm: r.stats.distanceKm,
  }));

  // Who drove the late deliveries (used to explain changes in the on-time rate).
  const lateCounts = new Map<string, number>();
  for (const d of delivered) if (outcome(d) === "late" && d.driverId) lateCounts.set(d.driverId, (lateCounts.get(d.driverId) ?? 0) + 1);
  const lateByDriver = [...lateCounts.entries()]
    .map(([id, late]) => ({ id, name: drivers.find((x) => x.id === id)?.fullName ?? "Former driver", late }))
    .sort((a, b2) => b2.late - a.late);

  const typeTotals = new Map<string, { costPaise: number; count: number }>();
  for (const m of maintenance) {
    const row = typeTotals.get(m.type) ?? { costPaise: 0, count: 0 };
    row.costPaise += m.costPaise;
    row.count++;
    typeTotals.set(m.type, row);
  }
  const maintenanceByType = [...typeTotals.entries()]
    .map(([type, v]) => ({ type, label: MAINTENANCE_TYPE_LABELS[type as MaintenanceType] ?? type, ...v }))
    .sort((a, b2) => b2.costPaise - a.costPaise);

  const activeDrivers = new Set(deliveries.filter((d) => d.driverId && d.status !== "PENDING" && d.status !== "CANCELLED").map((d) => d.driverId)).size;
  const distance = round1(delivered.reduce((s, d) => s + d.distanceKm, 0));
  const productivity = {
    activeDrivers,
    deliveredPerDriver: activeDrivers ? Math.round((delivered.length / activeDrivers) * 10) / 10 : null,
    kmPerDriver: activeDrivers ? round1(distance / activeDrivers) : null,
    kmPerDelivery: delivered.length ? round1(distance / delivered.length) : null,
  };

  return {
    range,
    unit: b.unit,
    summary: {
      totalDeliveries: deliveries.length,
      delivered: delivered.length,
      failed: failed.length,
      cancelled: deliveries.filter((d) => d.status === "CANCELLED").length,
      inProgress: deliveries.filter((d) => ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"].includes(d.status)).length,
      successRate: pct(delivered.length, delivered.length + failed.length),
      onTimeRate: pct(onTime.length, delivered.length),
      avgDurationMin: durations.length ? durations.reduce((s, m) => s + m, 0) / durations.length : null,
      fleetUtilization: pct(usedVehicles.size, operational.length),
      vehiclesUsed: usedVehicles.size,
      fleetSize: operational.length,
      distanceKm: round1(delivered.reduce((s, d) => s + d.distanceKm, 0)),
      fuelCostPaise: fuelCost,
      maintenanceCostPaise: maintCost,
      /** (fuel + maintenance spend in the period) / delivered deliveries. */
      costPerDeliveryPaise: delivered.length ? Math.round((fuelCost + maintCost) / delivered.length) : null,
    },
    timeline: [...timeline.values()].map((t) => ({ ...t, fuelCost: Math.round(t.fuelCost), maintenanceCost: Math.round(t.maintenanceCost) })),
    statusDistribution: DELIVERY_STATUSES.map((s) => ({ status: s, label: humanize(s), count: deliveries.filter((d) => d.status === s).length })).filter(
      (s) => s.count > 0,
    ),
    vehicles: vehicleRows,
    drivers: driverRows,
    lateByDriver,
    maintenanceByType,
    productivity,
  };
}

// --- Period comparison ------------------------------------------------------------

type Analysis = Awaited<ReturnType<typeof analyze>>;
const COMPARED = [
  "totalDeliveries", "delivered", "failed", "successRate", "onTimeRate", "avgDurationMin", "fleetUtilization", "distanceKm",
  "fuelCostPaise", "maintenanceCostPaise", "costPerDeliveryPaise",
] as const;
export type ComparedMetric = (typeof COMPARED)[number];

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const pctText = (d: Delta) => (d.pct == null ? "" : ` (${d.pct > 0 ? "+" : ""}${Math.round(d.pct * 100)}%)`);

/**
 * Plain-language explanations for the changes that matter. Every sentence is
 * built from the two periods' own numbers; nothing is inferred beyond them.
 */
export function explainChanges(current: Analysis, previous: Analysis, deltas: Record<ComparedMetric, Delta>): string[] {
  const out: string[] = [];
  const c = current.summary;
  const p = previous.summary;
  if (p.totalDeliveries === 0) {
    return ["There were no deliveries in the comparison period, so changes cannot be calculated."];
  }

  if (isSignificant(deltas.totalDeliveries, { pct: 0.1, abs: 3 })) {
    out.push(`Delivery volume ${deltas.totalDeliveries.change! > 0 ? "rose" : "fell"} from ${p.totalDeliveries} to ${c.totalDeliveries}${pctText(deltas.totalDeliveries)}.`);
  }

  const late = c.delivered - Math.round(((c.onTimeRate ?? 0) / 100) * c.delivered);
  const lateBefore = p.delivered - Math.round(((p.onTimeRate ?? 0) / 100) * p.delivered);
  if (deltas.onTimeRate.change != null && Math.abs(deltas.onTimeRate.change) >= 5 && c.delivered >= 5 && p.delivered >= 5) {
    let text = `On-time delivery ${deltas.onTimeRate.change > 0 ? "improved" : "dropped"} from ${p.onTimeRate}% to ${c.onTimeRate}%: ${late} of ${c.delivered} deliveries were late, against ${lateBefore} of ${p.delivered} before.`;
    const top = current.lateByDriver[0];
    if (deltas.onTimeRate.change < 0 && top && late > 0 && top.late / late >= 0.4 && top.late >= 2) {
      text += ` ${top.name} accounts for ${top.late} of the ${late} late deliveries.`;
    }
    out.push(text);
  }

  if (deltas.successRate.change != null && Math.abs(deltas.successRate.change) >= 5 && c.delivered + c.failed >= 5) {
    out.push(`Delivery success rate moved from ${p.successRate}% to ${c.successRate}% (${c.failed} failed now, ${p.failed} before).`);
  }

  if (isSignificant(deltas.fuelCostPaise, { pct: 0.15, abs: 100_000 })) {
    const up = deltas.fuelCostPaise.change! > 0;
    let text = `Fuel spend ${up ? "rose" : "fell"} from ${rupees(p.fuelCostPaise)} to ${rupees(c.fuelCostPaise)}${pctText(deltas.fuelCostPaise)}`;
    if (deltas.distanceKm.pct != null) {
      const km = Math.round(deltas.distanceKm.pct * 100);
      text += ` while delivered distance changed by ${km > 0 ? "+" : ""}${km}%`;
      const gap = (deltas.fuelCostPaise.pct ?? 0) - deltas.distanceKm.pct;
      text += Math.abs(gap) < 0.1 ? ", so the change follows the workload." : gap > 0 ? ", so fuel cost per km went up." : ", so fuel cost per km went down.";
    } else text += ".";
    out.push(text);
  }

  if (isSignificant(deltas.maintenanceCostPaise, { pct: 0.2, abs: 100_000 })) {
    const biggest = current.maintenanceByType[0];
    out.push(
      `Maintenance spend ${deltas.maintenanceCostPaise.change! > 0 ? "rose" : "fell"} from ${rupees(p.maintenanceCostPaise)} to ${rupees(c.maintenanceCostPaise)}${pctText(deltas.maintenanceCostPaise)}` +
        (biggest && deltas.maintenanceCostPaise.change! > 0 ? `; the largest share was ${biggest.label.toLowerCase()} (${rupees(biggest.costPaise)} across ${biggest.count} job${biggest.count === 1 ? "" : "s"}).` : "."),
    );
  }

  if (isSignificant(deltas.costPerDeliveryPaise, { pct: 0.15, abs: 5_000 })) {
    out.push(`Cost per delivery ${deltas.costPerDeliveryPaise.change! > 0 ? "increased" : "decreased"} from ${rupees(p.costPerDeliveryPaise!)} to ${rupees(c.costPerDeliveryPaise!)}${pctText(deltas.costPerDeliveryPaise)}.`);
  }

  if (deltas.fleetUtilization.change != null && Math.abs(deltas.fleetUtilization.change) >= 10) {
    out.push(`Fleet utilisation moved from ${p.fleetUtilization}% to ${c.fleetUtilization}% (${c.vehiclesUsed} of ${c.fleetSize} vehicles used, ${p.vehiclesUsed} before).`);
  }

  if (out.length === 0) out.push("No significant changes against the comparison period: the main metrics moved by less than the reporting thresholds.");
  return out;
}

/** Analytics for a period, optionally compared with the previous period or the same period last year. */
export async function getAnalytics(range: Range, mode: CompareMode = "none") {
  const compareWith = comparisonRange(range, mode);
  const [current, previous] = await Promise.all([analyze(range), compareWith ? analyze(compareWith) : Promise.resolve(null)]);
  if (!previous || !compareWith) return { ...current, comparison: null, deltas: null, insights: [] as string[] };

  const deltas = Object.fromEntries(
    COMPARED.map((key) => [key, delta(current.summary[key] as number | null, previous.summary[key] as number | null)]),
  ) as Record<ComparedMetric, Delta>;
  return {
    ...current,
    comparison: { mode, range: compareWith, summary: previous.summary },
    deltas,
    insights: explainChanges(current, previous, deltas),
  };
}
