/**
 * Driver performance scoring.
 *
 * All inputs come from closed delivery records. The formula is intentionally
 * simple and transparent (it is also shown in the UI and README):
 *
 *   successRate = delivered / (delivered + failed)
 *   onTimeRate  = delivered on or before the expected time / delivered
 *   experience  = min(1, delivered / EXPERIENCE_TARGET)
 *
 *   score = 100 x (0.45 x successRate + 0.40 x onTimeRate + 0.15 x experience)
 *
 * Cancelled deliveries are excluded: cancellation is a business decision, not a
 * driver outcome. Drivers with fewer than MIN_RATED_DELIVERIES closed deliveries
 * are shown as "Not rated" rather than ranked on too little evidence.
 */

export const SCORE_WEIGHTS = { success: 0.45, onTime: 0.4, experience: 0.15 } as const;
export const EXPERIENCE_TARGET = 15;
export const MIN_RATED_DELIVERIES = 3;

export interface PerformanceDelivery {
  status: string;
  distanceKm: number;
  expectedAt: Date | string;
  pickedUpAt: Date | string | null;
  deliveredAt: Date | string | null;
}

export interface PerformanceStats {
  total: number;
  delivered: number;
  failed: number;
  cancelled: number;
  active: number;
  onTime: number;
  late: number;
  successRate: number | null;
  /** delivered / (delivered + failed + cancelled): how much assigned work was completed. */
  completionRate: number | null;
  onTimeRate: number | null;
  /** Kilometres of completed (delivered) work. */
  distanceKm: number;
  /** Mean pickup-to-delivery time in minutes for delivered jobs. */
  avgDurationMin: number | null;
  /** 0..100, or null when the driver is not yet rated. */
  score: number | null;
}

export function computePerformance(deliveries: PerformanceDelivery[]): PerformanceStats {
  let delivered = 0;
  let failed = 0;
  let cancelled = 0;
  let active = 0;
  let onTime = 0;
  let distanceKm = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const d of deliveries) {
    if (d.status === "DELIVERED") {
      delivered++;
      distanceKm += d.distanceKm;
      if (d.deliveredAt && new Date(d.deliveredAt) <= new Date(d.expectedAt)) onTime++;
      if (d.deliveredAt && d.pickedUpAt) {
        const mins = (+new Date(d.deliveredAt) - +new Date(d.pickedUpAt)) / 60_000;
        if (mins >= 0) {
          durationSum += mins;
          durationCount++;
        }
      }
    } else if (d.status === "FAILED") failed++;
    else if (d.status === "CANCELLED") cancelled++;
    else if (d.status !== "PENDING") active++;
  }

  const closed = delivered + failed;
  const successRate = closed > 0 ? delivered / closed : null;
  const onTimeRate = delivered > 0 ? onTime / delivered : null;
  let score: number | null = null;
  if (closed >= MIN_RATED_DELIVERIES && successRate != null) {
    const experience = Math.min(1, delivered / EXPERIENCE_TARGET);
    score =
      100 *
      (SCORE_WEIGHTS.success * successRate +
        SCORE_WEIGHTS.onTime * (onTimeRate ?? 0) +
        SCORE_WEIGHTS.experience * experience);
    score = Math.round(score * 10) / 10;
  }

  return {
    total: deliveries.length,
    delivered,
    failed,
    cancelled,
    active,
    onTime,
    late: delivered - onTime,
    successRate,
    completionRate: delivered + failed + cancelled > 0 ? delivered / (delivered + failed + cancelled) : null,
    onTimeRate,
    distanceKm: Math.round(distanceKm * 10) / 10,
    avgDurationMin: durationCount ? durationSum / durationCount : null,
    score,
  };
}

/** Sorts rated drivers by score (ties broken by delivered count); unrated drivers go last. */
export function rankByScore<T extends { stats: PerformanceStats }>(rows: T[]): (T & { rank: number | null })[] {
  const rated = rows
    .filter((r) => r.stats.score != null)
    .sort((a, b) => b.stats.score! - a.stats.score! || b.stats.delivered - a.stats.delivered);
  const unrated = rows.filter((r) => r.stats.score == null).sort((a, b) => b.stats.delivered - a.stats.delivered);
  return [...rated.map((r, i) => ({ ...r, rank: i + 1 })), ...unrated.map((r) => ({ ...r, rank: null }))];
}
