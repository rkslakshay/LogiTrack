import { estimateRoadKm, polylineKm, syntheticPath, type LatLng } from "./geo";

export interface RouteResult {
  /** Polyline as [lat, lng] pairs. */
  geometry: LatLng[];
  distanceKm: number;
  /** "osrm" = road geometry from the public OSRM demo server; "local" = offline estimate. */
  source: "osrm" | "local";
}

const MAX_POINTS = 240;

/** Evenly downsamples a polyline so stored geometries stay small. */
export function simplify(points: LatLng[], max = MAX_POINTS): LatLng[] {
  if (points.length <= max) return points;
  const out: LatLng[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Offline fallback: curved straight-line path and a circuity-adjusted distance. */
export function localRoute(waypoints: LatLng[]): RouteResult {
  const geometry: LatLng[] = [];
  let distanceKm = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const leg = syntheticPath(waypoints[i - 1], waypoints[i], 16);
    geometry.push(...(i === 1 ? leg : leg.slice(1)));
    distanceKm += estimateRoadKm(waypoints[i - 1], waypoints[i]);
  }
  return {
    geometry: simplify(geometry).map(([a, b]) => [round5(a), round5(b)] as LatLng),
    distanceKm: Math.round(distanceKm * 10) / 10,
    source: "local",
  };
}

async function osrmRoute(waypoints: LatLng[]): Promise<RouteResult | null> {
  const base = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
  const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    headers: { "User-Agent": "LogiTrack-demo (local development)" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    code: string;
    routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
  };
  const best = json.routes?.[0];
  if (json.code !== "Ok" || !best?.geometry?.coordinates?.length) return null;
  const geometry = simplify(best.geometry.coordinates.map(([lng, lat]) => [round5(lat), round5(lng)] as LatLng));
  return { geometry, distanceKm: Math.round((best.distance / 1000) * 10) / 10, source: "osrm" };
}

/**
 * Route between waypoints. Uses the free public OSRM demo server when
 * ROUTING_PROVIDER=osrm (no key, no account) and silently falls back to the
 * local estimator on any failure, so the app works fully offline.
 *
 * These are estimates for planning and simulation only, not turn-by-turn navigation.
 */
export async function getRoute(waypoints: LatLng[], opts: { allowRemote?: boolean } = {}): Promise<RouteResult> {
  if (waypoints.length < 2) return { geometry: waypoints, distanceKm: 0, source: "local" };
  const remote = (opts.allowRemote ?? true) && process.env.ROUTING_PROVIDER === "osrm";
  if (remote) {
    try {
      const result = await osrmRoute(waypoints);
      if (result && polylineKm(result.geometry) > 0) return result;
    } catch {
      // Network unavailable / rate limited: fall through to the local estimator.
    }
  }
  return localRoute(waypoints);
}

export function parseGeometry(json: string | null | undefined): LatLng[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as LatLng[]) : [];
  } catch {
    return [];
  }
}
