/**
 * Delivery risk engine.
 *
 * A transparent, rule-based estimate of whether an open delivery will miss its
 * expected time. No machine learning and no external service: every flag comes
 * from one of the rules below and is returned with a plain-language reason.
 *
 * 1. Project an arrival time (ETA):
 *      in transit            now + remaining distance / speed
 *      picked up             now + loading allowance + full distance / speed
 *      assigned              max(now, scheduled) + pickup allowance + full distance / speed
 *      pending (no crew)     max(now, scheduled) + dispatch allowance + full distance / speed
 *    Travel time is multiplied by a history factor (how long past deliveries
 *    actually took compared with their estimate) and divided by the time scale
 *    (the GPS simulator moves vehicles faster than real time).
 * 2. slack = expected time - ETA.
 * 3. Rules, strongest first:
 *      HIGH    already marked delayed
 *      HIGH    slack < 0 (projected to arrive late)
 *      HIGH    pending and the scheduled start passed more than 60 min ago
 *      MEDIUM  slack below the buffer (15 min, or 15% of the trip if larger)
 *      MEDIUM  pending and the scheduled start has passed
 *      MEDIUM  assigned and the pickup is more than 30 min overdue
 *      MEDIUM  the driver was on time for under 60% of at least 5 recent deliveries
 *    Otherwise LOW.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export const RISK_RULES = {
  /** Minutes allowed for loading once the vehicle is at the pickup point. */
  loadingAllowanceMin: 10,
  /** Minutes allowed for an assigned driver to reach and load at the pickup point. */
  pickupAllowanceMin: 20,
  /** Minutes allowed to find and dispatch a crew for an unassigned delivery. */
  dispatchAllowanceMin: 45,
  /** Minimum comfortable buffer before the expected time. */
  minBufferMin: 15,
  /** ...or this share of the trip's travel time, whichever is larger. */
  bufferShare: 0.15,
  pickupOverdueMin: 30,
  unassignedOverdueHighMin: 60,
  driverOnTimeFloor: 0.6,
  driverMinSample: 5,
  /** The history factor is clamped so a few unusual trips cannot dominate. */
  historyFactorRange: [0.7, 2] as const,
} as const;

export interface RiskInput {
  status: string;
  scheduledAt: Date | string;
  expectedAt: Date | string;
  pickedUpAt: Date | string | null;
  /** 0..1 along the route. */
  progress: number;
  distanceKm: number;
  hasCrew: boolean;
}

export interface RiskContext {
  now: Date;
  averageSpeedKmh: number;
  /** Simulated seconds per real second (1 = real time). */
  timeScale?: number;
  /** Median of actual / estimated duration on past deliveries (1 = as estimated). */
  historyFactor?: number;
  /** Share of the driver's recent deliveries that were on time, with the sample size. */
  driverOnTimeRate?: number | null;
  driverSample?: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** Plain-language explanations, most important first. */
  reasons: string[];
  etaAt: Date;
  /** Minutes between the projected arrival and the expected time (negative = late). */
  slackMinutes: number;
  remainingKm: number;
}

const OPEN = new Set(["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"]);
const minutes = (n: number) => {
  const m = Math.max(1, Math.round(Math.abs(n)));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};
const rank: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Returns null for closed deliveries (nothing left to be at risk). */
export function assessRisk(delivery: RiskInput, ctx: RiskContext): RiskAssessment | null {
  if (!OPEN.has(delivery.status)) return null;
  const now = ctx.now.getTime();
  const scheduled = new Date(delivery.scheduledAt).getTime();
  const expected = new Date(delivery.expectedAt).getTime();
  const [lo, hi] = RISK_RULES.historyFactorRange;
  const factor = Math.min(hi, Math.max(lo, ctx.historyFactor ?? 1));
  const scale = Math.max(1, ctx.timeScale ?? 1);
  const speed = Math.max(1, ctx.averageSpeedKmh);
  const travelMin = (km: number) => ((km / speed) * 60 * factor) / scale;

  const pickedUp = !!delivery.pickedUpAt;
  const moving = pickedUp && (delivery.status === "IN_TRANSIT" || delivery.status === "DELAYED");
  const progress = Math.min(1, Math.max(0, delivery.progress));
  const remainingKm = moving ? delivery.distanceKm * (1 - progress) : delivery.distanceKm;

  let etaMs: number;
  if (moving) etaMs = now + travelMin(remainingKm) * 60_000;
  else if (pickedUp) etaMs = now + (RISK_RULES.loadingAllowanceMin + travelMin(remainingKm)) * 60_000;
  else if (delivery.hasCrew) etaMs = Math.max(now, scheduled) + (RISK_RULES.pickupAllowanceMin + travelMin(remainingKm)) * 60_000;
  else etaMs = Math.max(now, scheduled) + (RISK_RULES.dispatchAllowanceMin + travelMin(remainingKm)) * 60_000;

  const slack = (expected - etaMs) / 60_000;
  const buffer = Math.max(RISK_RULES.minBufferMin, travelMin(delivery.distanceKm) * RISK_RULES.bufferShare);

  let level: RiskLevel = "LOW";
  const reasons: string[] = [];
  const raise = (to: RiskLevel, reason: string) => {
    if (rank[to] > rank[level]) level = to;
    reasons.push(reason);
  };

  if (delivery.status === "DELAYED") raise("HIGH", "Already marked as delayed");
  if (slack < 0) {
    raise("HIGH", `Projected to arrive ${minutes(slack)} after the expected time`);
  } else if (slack < buffer) {
    raise("MEDIUM", `Only ${minutes(slack)} of buffer before the expected time`);
  }

  if (delivery.status === "PENDING" && scheduled < now) {
    const overdue = (now - scheduled) / 60_000;
    raise(
      overdue > RISK_RULES.unassignedOverdueHighMin ? "HIGH" : "MEDIUM",
      `Scheduled start passed ${minutes(overdue)} ago and no driver is assigned`,
    );
  }
  if (delivery.status === "ASSIGNED" && !pickedUp) {
    const overdue = (now - scheduled) / 60_000;
    if (overdue > RISK_RULES.pickupOverdueMin) raise("MEDIUM", `Pickup is ${minutes(overdue)} overdue`);
  }
  if (
    ctx.driverOnTimeRate != null &&
    (ctx.driverSample ?? 0) >= RISK_RULES.driverMinSample &&
    ctx.driverOnTimeRate < RISK_RULES.driverOnTimeFloor
  ) {
    raise("MEDIUM", `Driver was on time for only ${Math.round(ctx.driverOnTimeRate * 100)}% of their last ${ctx.driverSample} deliveries`);
  }
  if (level !== "LOW" && factor >= 1.2) {
    reasons.push(`Past deliveries have taken about ${Math.round((factor - 1) * 100)}% longer than estimated`);
  }
  if (level === "LOW") reasons.push(`On track with about ${minutes(slack)} of buffer`);

  return { level, reasons, etaAt: new Date(etaMs), slackMinutes: Math.round(slack), remainingKm: Math.round(remainingKm * 10) / 10 };
}

/** Median of actual / estimated durations; 1 when there is no usable history. */
export function historyFactor(samples: { actualMinutes: number; estimatedMinutes: number }[]): number {
  const ratios = samples
    .filter((s) => s.estimatedMinutes > 0 && s.actualMinutes > 0)
    .map((s) => s.actualMinutes / s.estimatedMinutes)
    .sort((a, b) => a - b);
  if (ratios.length < 3) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  const [lo, hi] = RISK_RULES.historyFactorRange;
  return Math.min(hi, Math.max(lo, median));
}

export const compareRisk = (a: RiskLevel, b: RiskLevel) => rank[b] - rank[a];
