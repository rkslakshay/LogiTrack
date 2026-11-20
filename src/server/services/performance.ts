import { format } from "date-fns";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { forbidden, notFound } from "@/lib/errors";
import { can } from "@/lib/permissions";
import {
  computePerformance, EXPERIENCE_TARGET, MIN_RATED_DELIVERIES, rankByScore, SCORE_WEIGHTS,
} from "@/lib/domain/performance";

const select = {
  id: true, code: true, driverId: true, status: true, distanceKm: true, scheduledAt: true, expectedAt: true,
  pickedUpAt: true, deliveredAt: true, customerName: true, destinationAddress: true, priority: true,
} as const;

const range = (from: Date | null, to: Date | null) =>
  from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

/** Minimum delivered jobs in each 30-day window before a trend is reported. */
export const TREND_MIN_DELIVERIES = 3;
const DAY = 86_400_000;

/**
 * Trend = on-time rate in the last 30 days of the period against the 30 days before.
 * Reported only when both windows hold at least TREND_MIN_DELIVERIES delivered jobs;
 * otherwise the direction is null (not enough evidence to call it a trend).
 */
export function performanceTrend(deliveries: { status: string; scheduledAt: Date; expectedAt: Date; deliveredAt: Date | null; pickedUpAt: Date | null; distanceKm: number }[], end: Date) {
  const cut = end.getTime() - 30 * DAY;
  const start = end.getTime() - 60 * DAY;
  const recent = computePerformance(deliveries.filter((d) => d.scheduledAt.getTime() > cut && d.scheduledAt <= end));
  const previous = computePerformance(deliveries.filter((d) => d.scheduledAt.getTime() > start && d.scheduledAt.getTime() <= cut));
  const enough = recent.delivered >= TREND_MIN_DELIVERIES && previous.delivered >= TREND_MIN_DELIVERIES;
  const change = enough && recent.onTimeRate != null && previous.onTimeRate != null ? recent.onTimeRate - previous.onTimeRate : null;
  return {
    recent: { delivered: recent.delivered, failed: recent.failed, onTimeRate: recent.onTimeRate },
    previous: { delivered: previous.delivered, failed: previous.failed, onTimeRate: previous.onTimeRate },
    /** Change in on-time rate as a fraction (0.1 = ten points better). */
    onTimeChange: change,
    direction: change == null ? null : change > 0.05 ? ("up" as const) : change < -0.05 ? ("down" as const) : ("flat" as const),
  };
}

export const SCORING = {
  weights: SCORE_WEIGHTS,
  experienceTarget: EXPERIENCE_TARGET,
  minRatedDeliveries: MIN_RATED_DELIVERIES,
};

/** Ranked leaderboard for every active driver, from deliveries scheduled in the period. */
export async function leaderboard(from: Date | null, to: Date | null) {
  const [drivers, deliveries] = await Promise.all([
    prisma.driver.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, fullName: true, status: true, joiningDate: true, vehicle: { select: { registrationNumber: true } } },
    }),
    prisma.delivery.findMany({ where: { driverId: { not: null }, ...range(from, to) }, select }),
  ]);
  const end = to ?? new Date();
  const rows = drivers.map((driver) => {
    const own = deliveries.filter((d) => d.driverId === driver.id);
    return { driver, stats: computePerformance(own), trend: performanceTrend(own, end) };
  });
  // Fleet-wide figures give every individual number something to be compared with.
  const all = computePerformance(deliveries);
  const working = rows.filter((r) => r.stats.delivered + r.stats.failed > 0).length;
  const fleet = {
    onTimeRate: all.onTimeRate, successRate: all.successRate, completionRate: all.completionRate, avgDurationMin: all.avgDurationMin,
    delivered: all.delivered, failed: all.failed, distanceKm: all.distanceKm,
    deliveredPerDriver: working ? Math.round((all.delivered / working) * 10) / 10 : null,
    distancePerDriver: working ? Math.round((all.distanceKm / working) * 10) / 10 : null,
  };
  return { rows: rankByScore(rows), scoring: SCORING, fleet };
}

export async function driverPerformance(actor: SessionUser, driverId: string, from: Date | null, to: Date | null) {
  // Drivers may only see their own numbers.
  if (!can(actor.role, "performance:view") && !(can(actor.role, "performance:own") && actor.driverId === driverId)) {
    throw forbidden();
  }
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, code: true, fullName: true, status: true, phone: true, joiningDate: true, licenseExpiry: true, vehicle: { select: { registrationNumber: true, name: true } } },
  });
  if (!driver) throw notFound("Driver");
  const deliveries = await prisma.delivery.findMany({ where: { driverId, ...range(from, to) }, select, orderBy: { scheduledAt: "desc" } });

  const months = new Map<string, typeof deliveries>();
  for (const d of deliveries) {
    const key = format(d.scheduledAt, "yyyy-MM");
    months.set(key, [...(months.get(key) ?? []), d]);
  }
  const monthly = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const s = computePerformance(rows);
      return {
        month: key,
        label: format(new Date(`${key}-01T00:00:00`), "MMM yy"),
        delivered: s.delivered,
        failed: s.failed,
        onTime: s.onTime,
        late: s.late,
        onTimeRate: s.onTimeRate == null ? null : Math.round(s.onTimeRate * 1000) / 10,
        successRate: s.successRate == null ? null : Math.round(s.successRate * 1000) / 10,
        distanceKm: s.distanceKm,
      };
    });

  // Rank within the same period for context.
  const board = await leaderboard(from, to);
  const position = board.rows.find((r) => r.driver.id === driverId);
  return {
    driver,
    stats: computePerformance(deliveries),
    rank: position?.rank ?? null,
    trend: performanceTrend(deliveries, to ?? new Date()),
    fleet: board.fleet,
    ratedDrivers: board.rows.filter((r) => r.rank != null).length,
    monthly,
    deliveries: deliveries.slice(0, 50),
    scoring: SCORING,
  };
}
