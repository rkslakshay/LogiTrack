import { describe, expect, it } from "vitest";
import {
  compareTours, estimateMinutes, estimateRoadKm, haversineKm, nearestNeighborOrder, pointAlong, polylineKm, respectsPrecedence,
  ROAD_CIRCUITY, syntheticPath, tourKm, twoOpt, type LatLng,
} from "@/lib/geo";
import { localRoute, simplify } from "@/lib/routing";

const MUMBAI: LatLng = [19.076, 72.8777];
const PUNE: LatLng = [18.5204, 73.8567];
const DELHI: LatLng = [28.6139, 77.209];

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm(MUMBAI, MUMBAI)).toBe(0);
  });

  it("matches known city distances", () => {
    // Mumbai-Pune is ~120 km and Mumbai-Delhi ~1150 km as the crow flies.
    expect(haversineKm(MUMBAI, PUNE)).toBeGreaterThan(115);
    expect(haversineKm(MUMBAI, PUNE)).toBeLessThan(125);
    expect(haversineKm(MUMBAI, DELHI)).toBeGreaterThan(1130);
    expect(haversineKm(MUMBAI, DELHI)).toBeLessThan(1170);
  });

  it("is symmetric", () => {
    expect(haversineKm(MUMBAI, PUNE)).toBeCloseTo(haversineKm(PUNE, MUMBAI), 9);
  });

  it("measures one degree of latitude as ~111 km", () => {
    expect(haversineKm([10, 77], [11, 77])).toBeCloseTo(111.2, 0);
  });
});

describe("road and time estimates", () => {
  it("applies the circuity factor", () => {
    expect(estimateRoadKm(MUMBAI, PUNE)).toBeCloseTo(haversineKm(MUMBAI, PUNE) * ROAD_CIRCUITY, 9);
  });

  it("converts distance to minutes and adds stop time", () => {
    expect(estimateMinutes(40, 40)).toBe(60);
    expect(estimateMinutes(20, 40)).toBe(30);
    expect(estimateMinutes(40, 40, 3, 10)).toBe(90);
    expect(estimateMinutes(40, 0)).toBe(0);
  });
});

describe("polylines", () => {
  const line: LatLng[] = [[0, 0], [0, 1], [0, 2]];

  it("sums segment lengths", () => {
    expect(polylineKm(line)).toBeCloseTo(haversineKm([0, 0], [0, 2]), 6);
    expect(polylineKm([[1, 1]])).toBe(0);
  });

  it("interpolates by distance along the line", () => {
    expect(pointAlong(line, 0).point).toEqual([0, 0]);
    expect(pointAlong(line, 1).point[1]).toBeCloseTo(2, 6);
    expect(pointAlong(line, 0.5).point[1]).toBeCloseTo(1, 4);
    expect(pointAlong(line, 0.25).point[1]).toBeCloseTo(0.5, 4);
  });

  it("clamps out-of-range fractions and reports heading", () => {
    expect(pointAlong(line, -1).point).toEqual([0, 0]);
    expect(pointAlong(line, 5).point[1]).toBeCloseTo(2, 6);
    expect(pointAlong(line, 0.5).heading).toBeCloseTo(90, 0); // heading due east
  });

  it("builds a synthetic path that starts and ends exactly at the endpoints", () => {
    const path = syntheticPath(MUMBAI, PUNE, 10);
    expect(path).toHaveLength(11);
    expect(path[0]).toEqual(MUMBAI);
    expect(path[10][0]).toBeCloseTo(PUNE[0], 9);
    expect(path[10][1]).toBeCloseTo(PUNE[1], 9);
    // A curve is longer than the straight line, but not wildly so.
    expect(polylineKm(path)).toBeGreaterThan(haversineKm(MUMBAI, PUNE));
    expect(polylineKm(path)).toBeLessThan(haversineKm(MUMBAI, PUNE) * 1.1);
  });

  it("downsamples long polylines while keeping both ends", () => {
    const long: LatLng[] = Array.from({ length: 1000 }, (_, i) => [i / 1000, 0]);
    const short = simplify(long, 50);
    expect(short).toHaveLength(50);
    expect(short[0]).toEqual(long[0]);
    expect(short[49]).toEqual(long[999]);
  });
});

describe("local route fallback", () => {
  it("returns an offline estimate with circuity-adjusted distance", () => {
    const route = localRoute([MUMBAI, PUNE]);
    expect(route.source).toBe("local");
    expect(route.distanceKm).toBeCloseTo(estimateRoadKm(MUMBAI, PUNE), 0);
    expect(route.geometry.length).toBeGreaterThan(2);
  });

  it("chains several waypoints", () => {
    const route = localRoute([MUMBAI, PUNE, DELHI]);
    expect(route.distanceKm).toBeCloseTo(estimateRoadKm(MUMBAI, PUNE) + estimateRoadKm(PUNE, DELHI), 0);
  });
});

describe("stop-order optimisation", () => {
  // Stops along a line, given in a deliberately bad order.
  const start: LatLng = [0, 0];
  const stops: LatLng[] = [[0, 5], [0, 1], [0, 4], [0, 2], [0, 3]];

  it("nearest neighbour visits the closest unvisited stop each time", () => {
    expect(nearestNeighborOrder(start, stops)).toEqual([1, 3, 4, 2, 0]);
  });

  it("visits every stop exactly once", () => {
    const order = nearestNeighborOrder(start, stops);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("2-opt never makes a tour longer and fixes a crossed route", () => {
    const bad = [0, 1, 2, 3, 4];
    const improved = twoOpt(start, stops, bad);
    expect(tourKm(start, stops, improved)).toBeLessThanOrEqual(tourKm(start, stops, bad));
    expect(tourKm(start, stops, improved)).toBeCloseTo(haversineKm([0, 0], [0, 5]), 6);
  });

  it("the optimised option is never worse than the others", () => {
    const tours = compareTours(start, stops);
    expect(tours.optimized.straightLineKm).toBeLessThanOrEqual(tours.nearestNeighbor.straightLineKm + 1e-9);
    expect(tours.optimized.straightLineKm).toBeLessThanOrEqual(tours.original.straightLineKm + 1e-9);
    expect(tours.original.order).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps every pickup before its drop-off", () => {
    // Stop 0 = pickup far away, stop 1 = its drop-off right next to the start.
    const pd: LatLng[] = [[0, 10], [0, 0.1], [0, 5], [0, 5.1]];
    const before = [null, 0, null, 2];
    const nn = nearestNeighborOrder(start, pd, before);
    expect(respectsPrecedence(nn, before)).toBe(true);
    expect(nn.indexOf(0)).toBeLessThan(nn.indexOf(1));

    const optimized = compareTours(start, pd, before).optimized.order;
    expect(respectsPrecedence(optimized, before)).toBe(true);
    // Without the constraint the greedy route would visit stop 1 first.
    expect(nearestNeighborOrder(start, pd)[0]).toBe(1);
  });

  it("detects precedence violations", () => {
    expect(respectsPrecedence([1, 0], [null, 0])).toBe(false);
    expect(respectsPrecedence([0, 1], [null, 0])).toBe(true);
    expect(respectsPrecedence([1, 0])).toBe(true);
  });
});
