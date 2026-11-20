/**
 * Fuel efficiency intelligence.
 *
 * Mileage is only ever computed from valid evidence: two consecutive fills of
 * the same vehicle with an increasing odometer. For each such interval
 *
 *   interval km/L = (odometer at this fill - odometer at previous fill) / litres added at this fill
 *
 * (the fill-to-fill method: the fuel added now replaces what was burnt since the
 * previous fill). When there is not enough evidence the result is `null` and a
 * flag says why; nothing is estimated or guessed.
 */

export const FUEL_RULES = {
  /** Intervals needed before a vehicle is judged against its peers or its own past. */
  minIntervalsForJudgement: 3,
  /** Mileage below this share of the peer median is "poor". */
  poorMileageShare: 0.8,
  /** Cost per km above this multiple of the peer median is "high". */
  highCostMultiple: 1.25,
  /** Recent mileage this far below the earlier average is a "drop". */
  dropShare: 0.15,
  /** An interval this far from the vehicle's own median suggests a missing or mistyped record. */
  suspectLow: 0.5,
  suspectHigh: 2,
  /** Days without a fuel record, while the vehicle kept working, before records look incomplete. */
  staleDays: 45,
} as const;

export type FuelFlagCode = "INSUFFICIENT_DATA" | "SUSPECT_RECORD" | "MILEAGE_DROP" | "POOR_MILEAGE" | "HIGH_COST" | "STALE_RECORDS";

export interface FuelFlag {
  code: FuelFlagCode;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface FuelFill {
  date: Date;
  quantityL: number;
  totalCostPaise: number;
  odometer: number;
}

export interface FuelVehicleInput {
  vehicleId: string;
  /** Vehicles are only compared with others of the same group (type + fuel). */
  group: string;
  fills: FuelFill[];
  /** Deliveries completed since the last fuel record (for the stale-records check). */
  deliveriesSinceLastFill?: number;
}

export interface FuelInterval {
  date: Date;
  km: number;
  litres: number;
  kmPerL: number;
  costPerKmPaise: number;
}

export interface FuelVehicleResult {
  vehicleId: string;
  group: string;
  fillCount: number;
  totalLitres: number;
  totalCostPaise: number;
  intervals: FuelInterval[];
  /** null when fewer than two valid fills exist. */
  mileageKmPerL: number | null;
  costPerKmPaise: number | null;
  recentMileage: number | null;
  earlierMileage: number | null;
  /** Fractional change of recent vs earlier mileage (negative = worse). */
  mileageChange: number | null;
  peerMedianMileage: number | null;
  peerCount: number;
  /** "high" needs enough intervals; otherwise figures are shown but not judged. */
  confidence: "none" | "low" | "high";
  flags: FuelFlag[];
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function intervalsOf(fills: FuelFill[]): FuelInterval[] {
  const sorted = [...fills].sort((a, b) => a.odometer - b.odometer || a.date.getTime() - b.date.getTime());
  const out: FuelInterval[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const km = sorted[i].odometer - sorted[i - 1].odometer;
    const litres = sorted[i].quantityL;
    // Only strictly increasing odometers and positive quantities are valid evidence.
    if (km <= 0 || litres <= 0) continue;
    out.push({ date: sorted[i].date, km, litres, kmPerL: km / litres, costPerKmPaise: sorted[i].totalCostPaise / km });
  }
  return out;
}

export function analyzeFuel(inputs: FuelVehicleInput[], now: Date = new Date()): FuelVehicleResult[] {
  const base = inputs.map((input) => {
    const intervals = intervalsOf(input.fills);
    const km = intervals.reduce((s, i) => s + i.km, 0);
    const litres = intervals.reduce((s, i) => s + i.litres, 0);
    const cost = intervals.reduce((s, i) => s + i.costPerKmPaise * i.km, 0);
    return {
      input,
      intervals,
      mileage: litres > 0 && km > 0 ? km / litres : null,
      costPerKm: km > 0 ? cost / km : null,
    };
  });

  return base.map(({ input, intervals, mileage, costPerKm }) => {
    const flags: FuelFlag[] = [];
    const n = intervals.length;
    const judged = n >= FUEL_RULES.minIntervalsForJudgement;
    const fills = input.fills;

    if (fills.length < 2) {
      flags.push({
        code: "INSUFFICIENT_DATA",
        severity: "INFO",
        message:
          fills.length === 0
            ? "No fuel records in this period, so mileage cannot be calculated."
            : "Only one fuel record: mileage needs at least two fills with odometer readings.",
      });
    } else if (n === 0) {
      flags.push({ code: "INSUFFICIENT_DATA", severity: "WARNING", message: "Odometer readings do not increase between fills, so mileage cannot be calculated." });
    }

    // Recent vs earlier (needs at least two intervals on each side).
    let recent: number | null = null;
    let earlier: number | null = null;
    let change: number | null = null;
    const byDate = [...intervals].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (byDate.length >= 4) {
      const split = byDate.length - 2;
      const ratio = (rows: FuelInterval[]) => rows.reduce((s, i) => s + i.km, 0) / rows.reduce((s, i) => s + i.litres, 0);
      earlier = ratio(byDate.slice(0, split));
      recent = ratio(byDate.slice(split));
      change = (recent - earlier) / earlier;
      if (change <= -FUEL_RULES.dropShare) {
        flags.push({
          code: "MILEAGE_DROP",
          severity: change <= -0.25 ? "CRITICAL" : "WARNING",
          message: `Mileage fell ${Math.round(-change * 100)}% on the last two fills (${one(recent)} km/L, previously ${one(earlier)} km/L). Worth checking tyres, load, driving pattern or a service.`,
        });
      }
    }

    // A single interval far from the vehicle's own median usually means a missed or mistyped record.
    const own = median(intervals.map((i) => i.kmPerL));
    if (own && n >= 4) {
      const odd = intervals.find((i) => i.kmPerL < own * FUEL_RULES.suspectLow || i.kmPerL > own * FUEL_RULES.suspectHigh);
      if (odd) {
        flags.push({
          code: "SUSPECT_RECORD",
          severity: "WARNING",
          message: `The fill on ${odd.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} works out to ${one(odd.kmPerL)} km/L against a usual ${one(own)} km/L. A fill may be missing or an odometer reading mistyped.`,
        });
      }
    }

    // Peer comparison: same vehicle type and fuel, each with enough intervals.
    const peers = base.filter(
      (b) => b.input.vehicleId !== input.vehicleId && b.input.group === input.group && b.intervals.length >= FUEL_RULES.minIntervalsForJudgement && b.mileage != null,
    );
    const peerMileage = peers.length >= 1 ? median(peers.map((p) => p.mileage!)) : null;
    const peerCost = peers.length >= 1 ? median(peers.filter((p) => p.costPerKm != null).map((p) => p.costPerKm!)) : null;
    if (judged && mileage != null && peerMileage != null && peers.length >= 2 && mileage < peerMileage * FUEL_RULES.poorMileageShare) {
      flags.push({
        code: "POOR_MILEAGE",
        severity: "WARNING",
        message: `${one(mileage)} km/L is ${Math.round((1 - mileage / peerMileage) * 100)}% below the median of ${peers.length} comparable vehicles (${one(peerMileage)} km/L).`,
      });
    }
    if (judged && costPerKm != null && peerCost != null && peers.length >= 2 && costPerKm > peerCost * FUEL_RULES.highCostMultiple) {
      flags.push({
        code: "HIGH_COST",
        severity: "WARNING",
        message: `Fuel costs ₹${(costPerKm / 100).toFixed(2)} per km, ${Math.round((costPerKm / peerCost - 1) * 100)}% above comparable vehicles (₹${(peerCost / 100).toFixed(2)} per km).`,
      });
    }

    if (fills.length > 0) {
      const last = fills.reduce((a, b) => (a.date > b.date ? a : b));
      const days = Math.floor((now.getTime() - last.date.getTime()) / 86_400_000);
      if (days > FUEL_RULES.staleDays && (input.deliveriesSinceLastFill ?? 0) > 0) {
        flags.push({
          code: "STALE_RECORDS",
          severity: "WARNING",
          message: `No fuel record for ${days} days although the vehicle completed ${input.deliveriesSinceLastFill} deliver${input.deliveriesSinceLastFill === 1 ? "y" : "ies"} since. Records may be incomplete.`,
        });
      }
    }

    return {
      vehicleId: input.vehicleId,
      group: input.group,
      fillCount: fills.length,
      totalLitres: Math.round(fills.reduce((s, f) => s + f.quantityL, 0) * 10) / 10,
      totalCostPaise: fills.reduce((s, f) => s + f.totalCostPaise, 0),
      intervals: byDate,
      mileageKmPerL: mileage,
      costPerKmPaise: costPerKm,
      recentMileage: recent,
      earlierMileage: earlier,
      mileageChange: change,
      peerMedianMileage: peerMileage,
      peerCount: peers.length,
      confidence: n === 0 ? "none" : judged ? "high" : "low",
      flags,
    };
  });
}

/** Monthly fleet trend: average price paid per litre and km/L across valid intervals ending in the month. */
export function fuelTrend(inputs: FuelVehicleInput[]): { month: string; avgPricePaise: number | null; kmPerL: number | null; costPerKmPaise: number | null; costPaise: number }[] {
  const months = new Map<string, { litres: number; cost: number; km: number; intervalLitres: number; intervalCost: number }>();
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const bucket = (k: string) => {
    if (!months.has(k)) months.set(k, { litres: 0, cost: 0, km: 0, intervalLitres: 0, intervalCost: 0 });
    return months.get(k)!;
  };
  for (const input of inputs) {
    for (const f of input.fills) {
      const b = bucket(key(f.date));
      b.litres += f.quantityL;
      b.cost += f.totalCostPaise;
    }
    for (const i of intervalsOf(input.fills)) {
      const b = bucket(key(i.date));
      b.km += i.km;
      b.intervalLitres += i.litres;
      b.intervalCost += i.costPerKmPaise * i.km;
    }
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      avgPricePaise: b.litres > 0 ? Math.round(b.cost / b.litres) : null,
      kmPerL: b.intervalLitres > 0 ? b.km / b.intervalLitres : null,
      costPerKmPaise: b.km > 0 ? b.intervalCost / b.km : null,
      costPaise: b.cost,
    }));
}
