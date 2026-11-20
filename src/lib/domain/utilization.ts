/**
 * Fleet utilisation intelligence. Pure calculations over delivery and
 * maintenance records; nothing here is stored.
 *
 * Per vehicle, for a period:
 *   period days     days in the period the vehicle existed (up to today)
 *   downtime days   days covered by maintenance (in progress, or completed between service start and completion)
 *   available days  period days - downtime days
 *   active days     distinct days with at least one delivery that was actually worked
 *                   (assigned or later; pending and cancelled deliveries do not count)
 *   utilisation     active days / available days
 *   idle            1 - utilisation
 *
 * A vehicle is flagged as under-utilised when it was available for at least
 * minDays days and either was not used at all, or its utilisation is below
 * both underAbsolute and underRelative x the fleet average.
 */

export const UTILIZATION_RULES = { minDays: 14, underAbsolute: 0.15, underRelative: 0.5 } as const;

const DAY = 86_400_000;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export interface UtilVehicle {
  id: string;
  status: string;
  createdAt: Date;
  hasDriver: boolean;
}
export interface UtilDelivery {
  vehicleId: string | null;
  status: string;
  scheduledAt: Date;
  distanceKm: number;
}
export interface UtilMaintenance {
  vehicleId: string;
  status: string;
  serviceDate: Date;
  completedAt: Date | null;
}

export interface VehicleUtilization {
  vehicleId: string;
  periodDays: number;
  downtimeDays: number;
  availableDays: number;
  activeDays: number;
  /** 0..1 */
  utilization: number;
  idle: number;
  deliveries: number;
  delivered: number;
  distanceKm: number;
  lastUsedAt: Date | null;
  underutilized: boolean;
  explanation: string | null;
}

export interface FleetUtilization {
  vehicles: VehicleUtilization[];
  fleet: {
    operationalVehicles: number;
    /** Mean utilisation across operational vehicles. */
    utilization: number;
    idle: number;
    /** Share of operational vehicles used at least once. */
    activeVehicleShare: number;
    idleVehicleShare: number;
    downtimeDays: number;
    /** Downtime as a share of all vehicle-days in the period. */
    downtimeShare: number;
    distanceKm: number;
    avgDistancePerVehicle: number;
    underutilizedCount: number;
  };
  /** Vehicles used per week, for the usage trend. */
  trend: { label: string; start: Date; vehiclesUsed: number; utilization: number }[];
}

/** Days (as local midnights) between two instants, inclusive of both ends. */
function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = startOfDay(from); d <= to; d = new Date(d.getTime() + DAY)) out.push(d);
  return out;
}

export function computeUtilization(
  vehicles: UtilVehicle[],
  deliveries: UtilDelivery[],
  maintenance: UtilMaintenance[],
  range: { from: Date; to: Date },
  now: Date = new Date(),
): FleetUtilization {
  const end = range.to < now ? range.to : now;
  const worked = (d: UtilDelivery) => d.status !== "PENDING" && d.status !== "CANCELLED";
  const operational = vehicles.filter((v) => v.status !== "INACTIVE");

  const rows: VehicleUtilization[] = operational.map((v) => {
    const start = v.createdAt > range.from ? v.createdAt : range.from;
    const days = start > end ? [] : eachDay(start, end);
    const periodDays = Math.max(1, days.length);
    const inPeriod = new Set(days.map(dayKey));

    const downtime = new Set<string>();
    for (const m of maintenance) {
      if (m.vehicleId !== v.id) continue;
      if (m.status !== "IN_PROGRESS" && m.status !== "COMPLETED") continue;
      const until = m.status === "IN_PROGRESS" ? now : (m.completedAt ?? m.serviceDate);
      for (const d of eachDay(m.serviceDate, until < m.serviceDate ? m.serviceDate : until)) {
        const key = dayKey(d);
        if (inPeriod.has(key)) downtime.add(key);
      }
    }

    const own = deliveries.filter((d) => d.vehicleId === v.id && d.scheduledAt >= range.from && d.scheduledAt <= range.to);
    const active = new Set(own.filter(worked).map((d) => dayKey(d.scheduledAt)));
    const delivered = own.filter((d) => d.status === "DELIVERED");
    const availableDays = Math.max(1, periodDays - downtime.size);
    const utilization = Math.min(1, active.size / availableDays);
    const lastUsed = own.filter(worked).reduce<Date | null>((latest, d) => (!latest || d.scheduledAt > latest ? d.scheduledAt : latest), null);

    return {
      vehicleId: v.id,
      periodDays,
      downtimeDays: downtime.size,
      availableDays,
      activeDays: active.size,
      utilization,
      idle: 1 - utilization,
      deliveries: own.filter(worked).length,
      delivered: delivered.length,
      distanceKm: Math.round(delivered.reduce((s, d) => s + d.distanceKm, 0) * 10) / 10,
      lastUsedAt: lastUsed,
      underutilized: false,
      explanation: null,
    };
  });

  const count = rows.length;
  const mean = count ? rows.reduce((s, r) => s + r.utilization, 0) / count : 0;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  for (const row of rows) {
    if (row.availableDays < UTILIZATION_RULES.minDays) continue;
    const below = row.utilization < UTILIZATION_RULES.underAbsolute && row.utilization < mean * UTILIZATION_RULES.underRelative;
    if (!below && row.activeDays > 0) continue;
    row.underutilized = true;
    const vehicle = operational.find((v) => v.id === row.vehicleId)!;
    const parts = [
      row.activeDays === 0
        ? `Not used on any of its ${row.availableDays} available days`
        : `Used on ${row.activeDays} of ${row.availableDays} available days (${pct(row.utilization)})`,
      `the fleet average is ${pct(mean)}`,
    ];
    let text = `${parts.join("; ")}.`;
    if (row.lastUsedAt) text += ` Last delivery ${Math.max(0, Math.round((end.getTime() - row.lastUsedAt.getTime()) / DAY))} days ago.`;
    if (!vehicle.hasDriver) text += " It has no regular driver assigned.";
    if (row.downtimeDays > 0) text += ` ${row.downtimeDays} day${row.downtimeDays === 1 ? " of maintenance downtime is" : "s of maintenance downtime are"} already excluded.`;
    row.explanation = text;
  }

  const vehicleDays = rows.reduce((s, r) => s + r.periodDays, 0);
  const downtimeDays = rows.reduce((s, r) => s + r.downtimeDays, 0);
  const distanceKm = Math.round(rows.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
  const used = rows.filter((r) => r.activeDays > 0).length;

  // Weekly usage trend (weeks start on Monday).
  const weekStart = (d: Date) => {
    const s = startOfDay(d);
    return new Date(s.getTime() - ((s.getDay() + 6) % 7) * DAY);
  };
  const ids = new Set(operational.map((v) => v.id));
  const weeks = new Map<number, { start: Date; vehicles: Set<string>; vehicleDays: Set<string> }>();
  for (let w = weekStart(range.from); w <= end; w = new Date(w.getTime() + 7 * DAY)) {
    weeks.set(w.getTime(), { start: w, vehicles: new Set(), vehicleDays: new Set() });
  }
  for (const d of deliveries) {
    if (!d.vehicleId || !ids.has(d.vehicleId) || !worked(d) || d.scheduledAt < range.from || d.scheduledAt > range.to) continue;
    const bucket = weeks.get(weekStart(d.scheduledAt).getTime());
    if (!bucket) continue;
    bucket.vehicles.add(d.vehicleId);
    bucket.vehicleDays.add(`${d.vehicleId}:${dayKey(d.scheduledAt)}`);
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const trend = [...weeks.values()].map((w) => ({
    label: `${String(w.start.getDate()).padStart(2, "0")} ${months[w.start.getMonth()]}`,
    start: w.start,
    vehiclesUsed: w.vehicles.size,
    utilization: count ? Math.round((w.vehicleDays.size / (count * 7)) * 1000) / 10 : 0,
  }));

  return {
    vehicles: rows.sort((a, b) => a.utilization - b.utilization),
    fleet: {
      operationalVehicles: count,
      utilization: mean,
      idle: 1 - mean,
      activeVehicleShare: count ? used / count : 0,
      idleVehicleShare: count ? (count - used) / count : 0,
      downtimeDays,
      downtimeShare: vehicleDays ? downtimeDays / vehicleDays : 0,
      distanceKm,
      avgDistancePerVehicle: count ? Math.round((distanceKm / count) * 10) / 10 : 0,
      underutilizedCount: rows.filter((r) => r.underutilized).length,
    },
    trend,
  };
}
