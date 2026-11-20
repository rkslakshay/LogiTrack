/**
 * Maintenance recommendations.
 *
 * These are SYSTEM-GENERATED suggestions, clearly separate from maintenance a
 * person has actually scheduled. They answer "when will this vehicle next need
 * a routine service?" from three facts in the database:
 *
 *   - the odometer now and at the last routine service (general service or oil change)
 *   - the date of that service
 *   - how many km per day the vehicle has been covering recently
 *
 * A routine service is due after SERVICE_INTERVALS[type].km kilometres or
 * SERVICE_INTERVALS[type].days days, whichever comes first.
 *
 *   km remaining   = interval km - (odometer now - odometer at last service)
 *   days by usage  = km remaining / average km per day
 *   days by time   = interval days - days since last service
 *   due in         = min(days by usage, days by time)
 *
 * The intervals are typical defaults for each vehicle class, not manufacturer
 * data for a specific model; a fleet would tune them to its own vehicles.
 */

export const SERVICE_INTERVALS: Record<string, { km: number; days: number }> = {
  BIKE: { km: 4_000, days: 120 },
  VAN: { km: 10_000, days: 180 },
  PICKUP: { km: 10_000, days: 180 },
  MINI_TRUCK: { km: 10_000, days: 180 },
  TRUCK: { km: 20_000, days: 180 },
  CONTAINER: { km: 25_000, days: 180 },
};
const DEFAULT_INTERVAL = { km: 10_000, days: 180 };

/** Recommendations are shown up to this many days ahead. */
export const RECOMMENDATION_HORIZON_DAYS = 60;
export const ROUTINE_TYPES = ["GENERAL_SERVICE", "OIL_CHANGE"];

export interface RecommendationInput {
  vehicleId: string;
  type: string;
  odometer: number;
  /** Latest completed routine service, if any. */
  lastService: { date: Date; odometer: number | null } | null;
  /** A routine service is already scheduled or in progress: nothing to recommend. */
  hasOpenRoutineJob: boolean;
  /** The last routine service already carries a next-service date or odometer set by a person. */
  followUpPlanned?: boolean;
  /** Average km per day from recent records; null when unknown. */
  avgDailyKm: number | null;
}

export interface Recommendation {
  vehicleId: string;
  urgency: "OVERDUE" | "SOON" | "PLANNED";
  basis: "NO_HISTORY" | "ODOMETER" | "TIME";
  kmSinceService: number | null;
  kmRemaining: number | null;
  daysSinceService: number | null;
  dueInDays: number | null;
  projectedDate: Date | null;
  interval: { km: number; days: number };
  reason: string;
}

const DAY = 86_400_000;
const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

export function recommendService(input: RecommendationInput, now: Date = new Date()): Recommendation | null {
  // Work a person has scheduled, or a follow-up they have planned, always takes precedence.
  if (input.hasOpenRoutineJob || input.followUpPlanned) return null;
  const interval = SERVICE_INTERVALS[input.type] ?? DEFAULT_INTERVAL;

  if (!input.lastService) {
    return {
      vehicleId: input.vehicleId, urgency: "SOON", basis: "NO_HISTORY", kmSinceService: null, kmRemaining: null, daysSinceService: null,
      dueInDays: null, projectedDate: null, interval,
      reason: `No general service or oil change is on record. A baseline service is recommended (odometer ${fmt(input.odometer)} km).`,
    };
  }

  const daysSince = Math.floor((now.getTime() - input.lastService.date.getTime()) / DAY);
  const daysByTime = interval.days - daysSince;
  const kmSince = input.lastService.odometer != null ? Math.max(0, input.odometer - input.lastService.odometer) : null;
  const kmRemaining = kmSince != null ? interval.km - kmSince : null;
  const daysByUsage =
    kmRemaining != null && input.avgDailyKm && input.avgDailyKm > 0 ? Math.ceil(kmRemaining / input.avgDailyKm) : kmRemaining != null && kmRemaining <= 0 ? 0 : null;

  const byUsage = daysByUsage != null && daysByUsage <= daysByTime;
  const dueInDays = byUsage ? daysByUsage! : daysByTime;
  if (dueInDays > RECOMMENDATION_HORIZON_DAYS) return null;

  const urgency: Recommendation["urgency"] = dueInDays <= 0 ? "OVERDUE" : dueInDays <= 30 ? "SOON" : "PLANNED";
  let reason: string;
  if (byUsage) {
    reason =
      kmRemaining! <= 0
        ? `${fmt(kmSince!)} km since the last routine service, ${fmt(-kmRemaining!)} km past the ${fmt(interval.km)} km interval.`
        : `${fmt(kmSince!)} km since the last routine service. At about ${fmt(input.avgDailyKm!)} km a day, the ${fmt(interval.km)} km interval is reached in roughly ${dueInDays} day${dueInDays === 1 ? "" : "s"}.`;
  } else {
    reason =
      daysByTime <= 0
        ? `${daysSince} days since the last routine service, ${-daysByTime} days past the ${interval.days}-day interval.`
        : `${daysSince} days since the last routine service; the ${interval.days}-day interval ends in ${daysByTime} day${daysByTime === 1 ? "" : "s"}.`;
    if (kmSince != null) reason += ` ${fmt(kmSince)} km covered since then.`;
  }

  return {
    vehicleId: input.vehicleId, urgency, basis: byUsage ? "ODOMETER" : "TIME", kmSinceService: kmSince, kmRemaining, daysSinceService: daysSince,
    dueInDays, projectedDate: new Date(now.getTime() + Math.max(0, dueInDays) * DAY), interval, reason,
  };
}

/** Average km per day from odometer readings (needs readings at least `minDays` apart). */
export function averageDailyKm(readings: { date: Date; odometer: number }[], minDays = 7): number | null {
  if (readings.length < 2) return null;
  const sorted = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (last.date.getTime() - first.date.getTime()) / DAY;
  const km = last.odometer - first.odometer;
  if (days < minDays || km <= 0) return null;
  return km / days;
}
