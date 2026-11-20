// Pure geospatial helpers: distances, polylines and stop-order optimisation.
// No I/O here, so everything is unit-testable and usable on client and server.

export type LatLng = [lat: number, lng: number];

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Roads are longer than straight lines. 1.3 is a commonly used circuity factor
 * for road networks; we use it whenever no real road geometry is available.
 */
export const ROAD_CIRCUITY = 1.3;

export function estimateRoadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_CIRCUITY;
}

/** Travel time in minutes at a constant average speed, plus a fixed handling allowance per stop. */
export function estimateMinutes(distanceKm: number, speedKmh = 40, stops = 0, minutesPerStop = 10): number {
  if (speedKmh <= 0) return 0;
  return Math.round((distanceKm / speedKmh) * 60 + stops * minutesPerStop);
}

/** Initial compass bearing from a to b in degrees (0 = north, 90 = east). */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Total length of a polyline in kilometres. */
export function polylineKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/**
 * Position at a fraction (0..1) of the way along a polyline, measured by distance.
 * Used by the GPS simulator so vehicles move at a steady speed along the route.
 */
export function pointAlong(points: LatLng[], fraction: number): { point: LatLng; heading: number } {
  if (points.length === 0) return { point: [0, 0], heading: 0 };
  if (points.length === 1) return { point: points[0], heading: 0 };
  const f = Math.min(1, Math.max(0, fraction));
  const total = polylineKm(points);
  if (total === 0) return { point: points[0], heading: 0 };
  let target = total * f;
  for (let i = 1; i < points.length; i++) {
    const seg = haversineKm(points[i - 1], points[i]);
    if (target <= seg || i === points.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, target / seg);
      const a = points[i - 1];
      const b = points[i];
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        heading: bearing(a, b),
      };
    }
    target -= seg;
  }
  return { point: points[points.length - 1], heading: 0 };
}

/**
 * Deterministic offline path between two points. It is NOT a road route: it is a
 * gently curved line (quadratic Bezier with a perpendicular offset) sampled into
 * segments so that the simulator has something smoother than a single straight hop.
 */
export function syntheticPath(a: LatLng, b: LatLng, segments = 24): LatLng[] {
  const dLat = b[0] - a[0];
  const dLng = b[1] - a[1];
  // Perpendicular offset of ~8% of the span; the side is chosen deterministically.
  const side = (Math.round((a[0] + b[1]) * 1000) % 2 === 0 ? 1 : -1) * 0.08;
  const ctrl: LatLng = [(a[0] + b[0]) / 2 - dLng * side, (a[1] + b[1]) / 2 + dLat * side];
  const pts: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
    ]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Stop-order optimisation (open path: fixed start, visit every stop once)
// ---------------------------------------------------------------------------

/** Length of the open tour start -> stops[order[0]] -> stops[order[1]] ... */
export function tourKm(start: LatLng, stops: LatLng[], order: number[]): number {
  let total = 0;
  let prev = start;
  for (const idx of order) {
    total += haversineKm(prev, stops[idx]);
    prev = stops[idx];
  }
  return total;
}

/**
 * Precedence constraints for pickup-and-delivery routing: before[i] is the index
 * of the stop that must be visited before stop i (or null when unconstrained).
 */
export type Precedence = (number | null)[];

export function respectsPrecedence(order: number[], before?: Precedence): boolean {
  if (!before) return true;
  const position = new Map<number, number>();
  order.forEach((stop, pos) => position.set(stop, pos));
  for (let stop = 0; stop < before.length; stop++) {
    const prerequisite = before[stop];
    if (prerequisite == null) continue;
    const a = position.get(prerequisite);
    const b = position.get(stop);
    if (a == null || b == null || a > b) return false;
  }
  return true;
}

/**
 * Greedy nearest-neighbour ordering from a fixed start. O(n^2).
 * A stop only becomes a candidate once its prerequisite (its pickup) is visited.
 */
export function nearestNeighborOrder(start: LatLng, stops: LatLng[], before?: Precedence): number[] {
  const remaining = stops.map((_, i) => i);
  const visited = new Set<number>();
  const order: number[] = [];
  let current = start;
  while (remaining.length) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const prerequisite = before?.[remaining[i]];
      if (prerequisite != null && !visited.has(prerequisite)) continue;
      const d = haversineKm(current, stops[remaining[i]]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) best = 0; // cyclic constraints: should not happen, but never loop forever
    const [next] = remaining.splice(best, 1);
    order.push(next);
    visited.add(next);
    current = stops[next];
  }
  return order;
}

/**
 * 2-opt local search on an open path with a fixed start: repeatedly reverse a
 * sub-sequence whenever doing so shortens the tour (and keeps every pickup
 * before its drop-off), until no improvement remains.
 */
export function twoOpt(start: LatLng, stops: LatLng[], initial: number[], before?: Precedence): number[] {
  let order = [...initial];
  let best = tourKm(start, stops, order);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (!respectsPrecedence(candidate, before)) continue;
        const len = tourKm(start, stops, candidate);
        if (len + 1e-9 < best) {
          order = candidate;
          best = len;
          improved = true;
        }
      }
    }
  }
  return order;
}

export interface OptimizedTour {
  order: number[];
  straightLineKm: number;
  algorithm: string;
}

export interface TourComparison {
  original: OptimizedTour;
  nearestNeighbor: OptimizedTour;
  optimized: OptimizedTour;
}

/** Runs each strategy so the UI can compare route options side by side. */
export function compareTours(start: LatLng, stops: LatLng[], before?: Precedence): TourComparison {
  const identity = stops.map((_, i) => i);
  const nn = nearestNeighborOrder(start, stops, before);
  const opt = twoOpt(start, stops, nn, before);
  return {
    original: { order: identity, straightLineKm: tourKm(start, stops, identity), algorithm: "as-entered" },
    nearestNeighbor: { order: nn, straightLineKm: tourKm(start, stops, nn), algorithm: "nearest-neighbor" },
    optimized: { order: opt, straightLineKm: tourKm(start, stops, opt), algorithm: "nearest-neighbor+2opt" },
  };
}
