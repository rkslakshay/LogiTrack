/** Fuel analytics computed purely from saved fuel records. */

export interface FuelEntry {
  date: Date | string;
  quantityL: number;
  totalCostPaise: number;
  odometer: number;
}

export interface FuelStats {
  fillCount: number;
  totalLitres: number;
  totalCostPaise: number;
  /** Distance between the first and last recorded odometer readings. */
  distanceKm: number;
  /** km per litre, or null when fewer than two fills exist. */
  mileageKmPerL: number | null;
  /** Paise per km, or null when no distance is known. */
  costPerKmPaise: number | null;
  avgPricePerLitrePaise: number | null;
}

/**
 * Mileage uses the standard fill-to-fill method: the fuel bought at the FIRST
 * fill was burnt before our first odometer reading, so it is excluded.
 *
 *   mileage = (last odometer - first odometer) / (litres of every fill except the first)
 *   cost/km = (cost of every fill except the first) / distance
 */
export function computeFuelStats(entries: FuelEntry[]): FuelStats {
  const sorted = [...entries].sort((a, b) => a.odometer - b.odometer || +new Date(a.date) - +new Date(b.date));
  const totalLitres = sorted.reduce((s, e) => s + e.quantityL, 0);
  const totalCostPaise = sorted.reduce((s, e) => s + e.totalCostPaise, 0);
  const stats: FuelStats = {
    fillCount: sorted.length,
    totalLitres,
    totalCostPaise,
    distanceKm: 0,
    mileageKmPerL: null,
    costPerKmPaise: null,
    avgPricePerLitrePaise: totalLitres > 0 ? Math.round(totalCostPaise / totalLitres) : null,
  };
  if (sorted.length < 2) return stats;
  const distance = sorted[sorted.length - 1].odometer - sorted[0].odometer;
  if (distance <= 0) return stats;
  const litresAfterFirst = totalLitres - sorted[0].quantityL;
  const costAfterFirst = totalCostPaise - sorted[0].totalCostPaise;
  stats.distanceKm = distance;
  stats.mileageKmPerL = litresAfterFirst > 0 ? distance / litresAfterFirst : null;
  stats.costPerKmPaise = costAfterFirst / distance;
  return stats;
}

/** Total cost in paise for a fill, rounded to the nearest paisa. */
export function fuelTotalPaise(quantityL: number, pricePerLitrePaise: number): number {
  return Math.round(quantityL * pricePerLitrePaise);
}

/**
 * An odometer reading must fit between the neighbouring fills (by date) of the
 * same vehicle. Returns an error message or null when valid.
 */
export function validateOdometer(
  reading: number,
  date: Date,
  others: { date: Date; odometer: number }[],
): string | null {
  let prev: { date: Date; odometer: number } | null = null;
  let next: { date: Date; odometer: number } | null = null;
  for (const o of others) {
    if (o.date <= date && (!prev || o.date > prev.date)) prev = o;
    if (o.date > date && (!next || o.date < next.date)) next = o;
  }
  if (prev && reading < prev.odometer) {
    return `Odometer cannot be lower than the previous fill (${prev.odometer.toLocaleString("en-IN")} km).`;
  }
  if (next && reading > next.odometer) {
    return `Odometer cannot be higher than the next recorded fill (${next.odometer.toLocaleString("en-IN")} km).`;
  }
  return null;
}
