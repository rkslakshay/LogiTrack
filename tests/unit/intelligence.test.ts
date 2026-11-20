import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth";
import { comparisonRange, delta, isSignificant } from "@/lib/domain/compare";
import { analyzeFuel, fuelTrend, type FuelFill, type FuelVehicleInput } from "@/lib/domain/fuel-intel";
import { averageDailyKm, recommendService, SERVICE_INTERVALS } from "@/lib/domain/maintenance-intel";
import { assessRisk, historyFactor, type RiskInput } from "@/lib/domain/risk";
import { computeUtilization } from "@/lib/domain/utilization";
import { presetRange } from "@/components/app/range-picker";

const NOW = new Date("2026-06-15T12:00:00");
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("delivery risk engine", () => {
  const ctx = { now: NOW, averageSpeedKmh: 40 };
  const base: RiskInput = { status: "IN_TRANSIT", scheduledAt: min(-60), expectedAt: min(120), pickedUpAt: min(-30), progress: 0.5, distanceKm: 40, hasCrew: true };

  it("returns nothing for closed deliveries", () => {
    for (const status of ["DELIVERED", "FAILED", "CANCELLED"]) expect(assessRisk({ ...base, status }, ctx)).toBeNull();
  });

  it("projects arrival from the remaining distance of a moving vehicle", () => {
    // 20 km left at 40 km/h = 30 minutes.
    const r = assessRisk(base, ctx)!;
    expect(r.remainingKm).toBe(20);
    expect(r.etaAt.getTime()).toBe(min(30).getTime());
    expect(r.slackMinutes).toBe(90);
    expect(r.level).toBe("LOW");
    expect(r.reasons[0]).toMatch(/On track/);
  });

  it("flags HIGH risk when the projected arrival is after the expected time, and says by how much", () => {
    const r = assessRisk({ ...base, expectedAt: min(10) }, ctx)!;
    expect(r.level).toBe("HIGH");
    expect(r.slackMinutes).toBe(-20);
    expect(r.reasons[0]).toBe("Projected to arrive 20 min after the expected time");
  });

  it("flags MEDIUM risk when the buffer is thin", () => {
    const r = assessRisk({ ...base, expectedAt: min(38) }, ctx)!;
    expect(r.level).toBe("MEDIUM");
    expect(r.reasons[0]).toBe("Only 8 min of buffer before the expected time");
  });

  it("always treats a delayed delivery as HIGH risk", () => {
    const r = assessRisk({ ...base, status: "DELAYED", expectedAt: min(600) }, ctx)!;
    expect(r.level).toBe("HIGH");
    expect(r.reasons).toContain("Already marked as delayed");
  });

  it("adds pickup and dispatch allowances for deliveries that have not left", () => {
    const assigned = assessRisk({ ...base, status: "ASSIGNED", pickedUpAt: null, progress: 0, scheduledAt: min(30), expectedAt: min(300) }, ctx)!;
    // starts at the scheduled time + 20 min pickup + 60 min travel
    expect(assigned.etaAt.getTime()).toBe(min(30 + 20 + 60).getTime());
    const pending = assessRisk({ ...base, status: "PENDING", hasCrew: false, pickedUpAt: null, progress: 0, scheduledAt: min(30), expectedAt: min(300) }, ctx)!;
    expect(pending.etaAt.getTime()).toBe(min(30 + 45 + 60).getTime());
    expect(pending.level).toBe("LOW");
  });

  it("escalates an unassigned delivery whose scheduled start has passed", () => {
    const pending: RiskInput = { ...base, status: "PENDING", hasCrew: false, pickedUpAt: null, progress: 0, expectedAt: min(600) };
    const medium = assessRisk({ ...pending, scheduledAt: min(-40) }, ctx)!;
    expect(medium.level).toBe("MEDIUM");
    expect(medium.reasons[0]).toBe("Scheduled start passed 40 min ago and no driver is assigned");
    expect(assessRisk({ ...pending, scheduledAt: min(-90) }, ctx)!.level).toBe("HIGH");
  });

  it("flags an overdue pickup", () => {
    const r = assessRisk({ ...base, status: "ASSIGNED", pickedUpAt: null, progress: 0, scheduledAt: min(-45), expectedAt: min(600) }, ctx)!;
    expect(r.level).toBe("MEDIUM");
    expect(r.reasons).toContain("Pickup is 45 min overdue");
  });

  it("uses the driver's punctuality only with enough history", () => {
    const comfortable = { ...base, expectedAt: min(600) };
    expect(assessRisk(comfortable, { ...ctx, driverOnTimeRate: 0.4, driverSample: 3 })!.level).toBe("LOW");
    const r = assessRisk(comfortable, { ...ctx, driverOnTimeRate: 0.4, driverSample: 8 })!;
    expect(r.level).toBe("MEDIUM");
    expect(r.reasons[0]).toBe("Driver was on time for only 40% of their last 8 deliveries");
  });

  it("stretches travel time by the history factor and compresses it by the time scale", () => {
    expect(assessRisk(base, { ...ctx, historyFactor: 1.5 })!.etaAt.getTime()).toBe(min(45).getTime());
    expect(assessRisk(base, { ...ctx, timeScale: 10 })!.etaAt.getTime()).toBe(min(3).getTime());
    // The factor is clamped so one freak trip cannot dominate.
    expect(assessRisk(base, { ...ctx, historyFactor: 50 })!.etaAt.getTime()).toBe(min(60).getTime());
    const late = assessRisk({ ...base, expectedAt: min(40) }, { ...ctx, historyFactor: 1.5 })!;
    expect(late.level).toBe("HIGH");
    expect(late.reasons.at(-1)).toBe("Past deliveries have taken about 50% longer than estimated");
  });

  it("derives the history factor as a clamped median, and needs three samples", () => {
    expect(historyFactor([])).toBe(1);
    expect(historyFactor([{ actualMinutes: 300, estimatedMinutes: 100 }])).toBe(1);
    const s = (a: number) => ({ actualMinutes: a, estimatedMinutes: 100 });
    expect(historyFactor([s(100), s(120), s(500)])).toBe(1.2);
    expect(historyFactor([s(10), s(10), s(10)])).toBe(0.7);
    expect(historyFactor([s(900), s(900), s(900)])).toBe(2);
  });
});

describe("fleet utilisation", () => {
  const range = { from: day(-29), to: day(0) };
  const vehicle = (id: string, extra = {}) => ({ id, status: "AVAILABLE", createdAt: day(-400), hasDriver: true, ...extra });
  const job = (vehicleId: string, offset: number, status = "DELIVERED", km = 20) => ({ vehicleId, status, scheduledAt: day(offset), distanceKm: km });

  it("computes active, idle and utilisation from distinct working days", () => {
    const result = computeUtilization([vehicle("a")], [job("a", -1), job("a", -1), job("a", -5), job("a", -9)], [], range, NOW);
    const row = result.vehicles[0];
    expect(row.periodDays).toBe(30);
    expect(row.activeDays).toBe(3); // two jobs on the same day count once
    expect(row.utilization).toBeCloseTo(3 / 30, 9);
    expect(row.idle).toBeCloseTo(27 / 30, 9);
    expect(row.deliveries).toBe(4);
    expect(row.distanceKm).toBe(80);
  });

  it("ignores pending and cancelled deliveries and work outside the period", () => {
    const result = computeUtilization([vehicle("a")], [job("a", -2, "PENDING"), job("a", -3, "CANCELLED"), job("a", -60), job("a", -4, "FAILED")], [], range, NOW);
    expect(result.vehicles[0].activeDays).toBe(1); // the failed attempt was still worked
    expect(result.vehicles[0].delivered).toBe(0);
  });

  it("removes maintenance downtime from the days a vehicle was available", () => {
    const maintenance = [{ vehicleId: "a", status: "COMPLETED", serviceDate: day(-10), completedAt: day(-6) }];
    const row = computeUtilization([vehicle("a")], [job("a", -1)], maintenance, range, NOW).vehicles[0];
    expect(row.downtimeDays).toBe(5);
    expect(row.availableDays).toBe(25);
    expect(row.utilization).toBeCloseTo(1 / 25, 9);
  });

  it("counts in-progress maintenance up to today", () => {
    const row = computeUtilization([vehicle("a")], [], [{ vehicleId: "a", status: "IN_PROGRESS", serviceDate: day(-2), completedAt: null }], range, NOW).vehicles[0];
    expect(row.downtimeDays).toBe(3);
  });

  it("summarises the fleet and excludes inactive vehicles", () => {
    const vehicles = [vehicle("a"), vehicle("b"), vehicle("c"), vehicle("z", { status: "INACTIVE" })];
    const jobs = [...Array.from({ length: 15 }, (_, i) => job("a", -i - 1)), ...Array.from({ length: 6 }, (_, i) => job("b", -i - 1)), job("z", -1)];
    const { fleet } = computeUtilization(vehicles, jobs, [], range, NOW);
    expect(fleet.operationalVehicles).toBe(3);
    expect(fleet.utilization).toBeCloseTo((15 / 30 + 6 / 30 + 0) / 3, 9);
    expect(fleet.activeVehicleShare).toBeCloseTo(2 / 3, 9);
    expect(fleet.idleVehicleShare).toBeCloseTo(1 / 3, 9);
    expect(fleet.distanceKm).toBe(420);
    expect(fleet.avgDistancePerVehicle).toBe(140);
  });

  it("flags unused and far-below-average vehicles, with a factual explanation", () => {
    const vehicles = [vehicle("busy"), vehicle("busy2"), vehicle("rare"), vehicle("never", { hasDriver: false })];
    const jobs = [
      ...Array.from({ length: 20 }, (_, i) => job("busy", -i - 1)),
      ...Array.from({ length: 18 }, (_, i) => job("busy2", -i - 1)),
      job("rare", -12),
    ];
    const result = computeUtilization(vehicles, jobs, [], range, NOW);
    const by = Object.fromEntries(result.vehicles.map((v) => [v.vehicleId, v]));
    expect(by.busy.underutilized).toBe(false);
    expect(by.rare.underutilized).toBe(true);
    expect(by.rare.explanation).toMatch(/^Used on 1 of 30 available days \(3\.3%\); the fleet average is 32\.5%\. Last delivery 12 days ago\./);
    expect(by.never.underutilized).toBe(true);
    expect(by.never.explanation).toContain("Not used on any of its 30 available days");
    expect(by.never.explanation).toContain("no regular driver assigned");
    expect(result.fleet.underutilizedCount).toBe(2);
  });

  it("does not judge a vehicle that has been in the fleet for too short a time", () => {
    const result = computeUtilization([vehicle("new", { createdAt: day(-5) })], [], [], range, NOW);
    expect(result.vehicles[0].periodDays).toBe(6);
    expect(result.vehicles[0].underutilized).toBe(false);
  });

  it("builds a weekly usage trend", () => {
    const result = computeUtilization([vehicle("a"), vehicle("b")], [job("a", -1), job("b", -1), job("a", -15)], [], range, NOW);
    expect(result.trend.length).toBeGreaterThanOrEqual(4);
    expect(result.trend.reduce((s, w) => s + w.vehiclesUsed, 0)).toBe(3);
    expect(Math.max(...result.trend.map((w) => w.vehiclesUsed))).toBe(2);
  });
});

describe("fuel intelligence", () => {
  const fill = (offset: number, odometer: number, quantityL: number, price = 9000): FuelFill => ({ date: day(offset), odometer, quantityL, totalCostPaise: Math.round(quantityL * price) });
  /** Fills every 10 days, each covering `km` on `litres`. */
  const steady = (id: string, group: string, kmPerL: number, count = 6): FuelVehicleInput => ({
    vehicleId: id, group,
    fills: Array.from({ length: count }, (_, i) => fill(-10 * (count - i), 10_000 + i * 500, 500 / kmPerL)),
  });
  const find = (results: ReturnType<typeof analyzeFuel>, id: string) => results.find((r) => r.vehicleId === id)!;

  it("computes mileage fill-to-fill from valid intervals only", () => {
    const r = analyzeFuel([{ vehicleId: "a", group: "VAN:DIESEL", fills: [fill(-30, 10_000, 40), fill(-20, 10_600, 50), fill(-10, 11_140, 45)] }], NOW)[0];
    expect(r.intervals).toHaveLength(2);
    expect(r.mileageKmPerL).toBeCloseTo(1140 / 95, 6);
    expect(r.costPerKmPaise).toBeCloseTo((95 * 9000) / 1140, 6);
    expect(r.confidence).toBe("low"); // two intervals: shown, but not judged
    expect(r.flags).toHaveLength(0);
  });

  it("refuses to calculate mileage without enough evidence", () => {
    const [none, single, flat] = analyzeFuel(
      [
        { vehicleId: "none", group: "g", fills: [] },
        { vehicleId: "single", group: "g", fills: [fill(-5, 5000, 30)] },
        { vehicleId: "flat", group: "g", fills: [fill(-9, 5000, 30), fill(-5, 5000, 30)] },
      ],
      NOW,
    );
    for (const r of [none, single, flat]) {
      expect(r.mileageKmPerL).toBeNull();
      expect(r.costPerKmPaise).toBeNull();
      expect(r.confidence).toBe("none");
      expect(r.flags[0].code).toBe("INSUFFICIENT_DATA");
    }
    expect(single.flags[0].message).toMatch(/Only one fuel record/);
    expect(flat.flags[0].message).toMatch(/do not increase/);
  });

  it("ignores intervals with a non-increasing odometer instead of producing nonsense", () => {
    const r = analyzeFuel([{ vehicleId: "a", group: "g", fills: [fill(-30, 10_000, 40), fill(-20, 10_500, 50), fill(-10, 10_500, 20)] }], NOW)[0];
    expect(r.intervals).toHaveLength(1);
    expect(r.mileageKmPerL).toBe(10);
  });

  it("detects a recent drop in mileage against the vehicle's own history", () => {
    const fills = [fill(-60, 10_000, 40), fill(-50, 10_500, 50), fill(-40, 11_000, 50), fill(-30, 11_500, 50), fill(-20, 12_000, 70), fill(-10, 12_500, 72)];
    const r = analyzeFuel([{ vehicleId: "a", group: "g", fills }], NOW)[0];
    expect(r.earlierMileage).toBeCloseTo(10, 6);
    expect(r.recentMileage).toBeCloseTo(1000 / 142, 6);
    expect(r.mileageChange).toBeCloseTo(-0.2958, 3);
    const flag = r.flags.find((f) => f.code === "MILEAGE_DROP")!;
    expect(flag.severity).toBe("CRITICAL");
    expect(flag.message).toMatch(/^Mileage fell 30% on the last two fills \(7\.0 km\/L, previously 10\.0 km\/L\)/);
  });

  it("does not report a trend from too few intervals", () => {
    const r = analyzeFuel([{ vehicleId: "a", group: "g", fills: [fill(-30, 10_000, 40), fill(-20, 10_500, 50), fill(-10, 11_000, 80)] }], NOW)[0];
    expect(r.mileageChange).toBeNull();
    expect(r.flags.some((f) => f.code === "MILEAGE_DROP")).toBe(false);
  });

  it("compares a vehicle only with others of the same type and fuel", () => {
    const results = analyzeFuel([steady("good1", "TRUCK:DIESEL", 6), steady("good2", "TRUCK:DIESEL", 6.4), steady("poor", "TRUCK:DIESEL", 4.2), steady("bike", "BIKE:PETROL", 50)], NOW);
    const poor = find(results, "poor");
    expect(poor.peerCount).toBe(2);
    expect(poor.peerMedianMileage).toBeCloseTo(6.2, 6);
    expect(poor.flags.map((f) => f.code)).toEqual(["POOR_MILEAGE", "HIGH_COST"]);
    expect(poor.flags[0].message).toBe("4.2 km/L is 32% below the median of 2 comparable vehicles (6.2 km/L).");
    expect(find(results, "good1").flags).toHaveLength(0);
    // A truck is never called "poor" for doing fewer km/L than a motorbike.
    expect(find(results, "bike").peerCount).toBe(0);
    expect(find(results, "bike").flags).toHaveLength(0);
  });

  it("needs at least two comparable vehicles before judging against peers", () => {
    const results = analyzeFuel([steady("a", "VAN:CNG", 20), steady("b", "VAN:CNG", 10)], NOW);
    expect(find(results, "b").flags.some((f) => f.code === "POOR_MILEAGE")).toBe(false);
  });

  it("spots an interval that suggests a missing or mistyped record", () => {
    const fills = [fill(-60, 10_000, 40), fill(-50, 10_500, 50), fill(-40, 11_000, 50), fill(-30, 12_500, 50), fill(-20, 13_000, 50), fill(-10, 13_500, 50)];
    const r = analyzeFuel([{ vehicleId: "a", group: "g", fills }], NOW)[0];
    const flag = r.flags.find((f) => f.code === "SUSPECT_RECORD")!;
    expect(flag.message).toMatch(/works out to 30\.0 km\/L against a usual 10\.0 km\/L/);
  });

  it("flags stale records only when the vehicle kept working", () => {
    const old = [fill(-90, 10_000, 40), fill(-80, 10_500, 50)];
    const [idle, working] = analyzeFuel(
      [
        { vehicleId: "idle", group: "g", fills: old, deliveriesSinceLastFill: 0 },
        { vehicleId: "working", group: "g", fills: old, deliveriesSinceLastFill: 7 },
      ],
      NOW,
    );
    expect(idle.flags.some((f) => f.code === "STALE_RECORDS")).toBe(false);
    expect(working.flags.find((f) => f.code === "STALE_RECORDS")!.message).toMatch(/No fuel record for 80 days although the vehicle completed 7 deliveries/);
  });

  it("builds a monthly price and efficiency trend", () => {
    const trend = fuelTrend([{ vehicleId: "a", group: "g", fills: [fill(-70, 10_000, 40, 9000), fill(-40, 10_500, 50, 9200), fill(-5, 11_000, 50, 9500)] }]);
    expect(trend).toHaveLength(3);
    expect(trend.map((t) => t.avgPricePaise)).toEqual([9000, 9200, 9500]);
    expect(trend[0].kmPerL).toBeNull(); // the first fill closes no interval
    expect(trend[1].kmPerL).toBe(10);
    expect(trend[2].costPerKmPaise).toBeCloseTo(950, 6);
  });
});

describe("maintenance recommendations", () => {
  const base = { vehicleId: "v", type: "VAN", odometer: 50_000, hasOpenRoutineJob: false, avgDailyKm: 100 };

  it("recommends a baseline service when there is no history", () => {
    const r = recommendService({ ...base, lastService: null }, NOW)!;
    expect(r).toMatchObject({ basis: "NO_HISTORY", urgency: "SOON", dueInDays: null });
    expect(r.reason).toMatch(/No general service or oil change is on record/);
  });

  it("never duplicates work a person has scheduled or planned", () => {
    expect(recommendService({ ...base, lastService: null, hasOpenRoutineJob: true }, NOW)).toBeNull();
    expect(recommendService({ ...base, lastService: { date: day(-400), odometer: 10_000 }, followUpPlanned: true }, NOW)).toBeNull();
  });

  it("projects the due date from odometer and recent usage", () => {
    // 8,000 km since service, interval 10,000 km, 100 km/day: 20 days.
    const r = recommendService({ ...base, lastService: { date: day(-60), odometer: 42_000 } }, NOW)!;
    expect(r).toMatchObject({ basis: "ODOMETER", urgency: "SOON", kmSinceService: 8000, kmRemaining: 2000, dueInDays: 20 });
    expect(r.projectedDate!.getTime()).toBe(day(20).getTime());
    expect(r.reason).toBe("8,000 km since the last routine service. At about 100 km a day, the 10,000 km interval is reached in roughly 20 days.");
  });

  it("falls back to the time interval when usage is low or unknown", () => {
    const r = recommendService({ ...base, avgDailyKm: null, lastService: { date: day(-160), odometer: 49_000 } }, NOW)!;
    expect(r).toMatchObject({ basis: "TIME", urgency: "SOON", dueInDays: 20, daysSinceService: 160 });
    expect(r.reason).toMatch(/160 days since the last routine service; the 180-day interval ends in 20 days\. 1,000 km covered since then\./);
  });

  it("marks a service overdue by odometer or by time", () => {
    const byKm = recommendService({ ...base, lastService: { date: day(-30), odometer: 38_500 } }, NOW)!;
    expect(byKm).toMatchObject({ urgency: "OVERDUE", basis: "ODOMETER" });
    expect(byKm.reason).toBe("11,500 km since the last routine service, 1,500 km past the 10,000 km interval.");
    const byTime = recommendService({ ...base, avgDailyKm: 5, lastService: { date: day(-200), odometer: 49_800 } }, NOW)!;
    expect(byTime).toMatchObject({ urgency: "OVERDUE", basis: "TIME" });
  });

  it("stays silent when the next service is far away", () => {
    expect(recommendService({ ...base, avgDailyKm: 20, lastService: { date: day(-10), odometer: 49_500 } }, NOW)).toBeNull();
  });

  it("uses the interval for the vehicle type", () => {
    expect(SERVICE_INTERVALS.BIKE.km).toBeLessThan(SERVICE_INTERVALS.TRUCK.km);
    // 3,500 km since service: close for a bike (4,000), nowhere near for a truck (20,000).
    const last = { date: day(-20), odometer: 46_500 };
    expect(recommendService({ ...base, type: "BIKE", lastService: last }, NOW)?.urgency).toBe("SOON");
    expect(recommendService({ ...base, type: "TRUCK", lastService: last }, NOW)).toBeNull();
  });

  it("derives average daily distance only from readings far enough apart", () => {
    expect(averageDailyKm([{ date: day(-30), odometer: 10_000 }, { date: day(0), odometer: 13_000 }])).toBe(100);
    expect(averageDailyKm([{ date: day(-2), odometer: 10_000 }, { date: day(0), odometer: 13_000 }])).toBeNull();
    expect(averageDailyKm([{ date: day(-30), odometer: 10_000 }])).toBeNull();
    expect(averageDailyKm([{ date: day(-30), odometer: 10_000 }, { date: day(0), odometer: 10_000 }])).toBeNull();
  });
});

describe("period comparison", () => {
  it("compares with the period of the same length immediately before", () => {
    const range = { from: new Date("2026-06-01T00:00:00"), to: new Date("2026-06-30T23:59:59.999") };
    const prev = comparisonRange(range, "previous")!;
    expect(prev.from.getTime()).toBe(new Date("2026-05-02T00:00:00").getTime());
    expect(prev.to.getTime()).toBe(range.from.getTime() - 1);
    expect(comparisonRange(range, "none")).toBeNull();
  });

  it("compares with the same dates one year earlier", () => {
    const prev = comparisonRange({ from: new Date("2026-03-01T00:00:00"), to: new Date("2026-03-31T23:59:59") }, "year")!;
    expect(prev.from.getFullYear()).toBe(2025);
    expect(prev.from.getMonth()).toBe(2);
    expect(prev.to.getDate()).toBe(31);
  });

  it("computes absolute and relative change, and admits when it cannot", () => {
    expect(delta(120, 100)).toEqual({ current: 120, previous: 100, change: 20, pct: 0.2 });
    expect(delta(80, 100).pct).toBeCloseTo(-0.2, 9);
    expect(delta(5, 0)).toMatchObject({ change: 5, pct: null }); // no baseline to divide by
    expect(delta(null, 100)).toMatchObject({ change: null, pct: null });
    expect(delta(100, undefined)).toMatchObject({ change: null, pct: null });
  });

  it("only calls a change significant when it clears both thresholds", () => {
    expect(isSignificant(delta(120, 100), { pct: 0.1, abs: 10 })).toBe(true);
    expect(isSignificant(delta(104, 100), { pct: 0.1 })).toBe(false);
    expect(isSignificant(delta(3, 2), { pct: 0.1, abs: 3 })).toBe(false); // +50% but only one more
    expect(isSignificant(delta(null, 2))).toBe(false);
  });

  it("offers calendar periods to date", () => {
    const today = new Date("2026-06-17T10:00:00"); // a Wednesday
    expect(presetRange("week", today)).toEqual({ from: "2026-06-15", to: "2026-06-17" });
    expect(presetRange("month", today)).toEqual({ from: "2026-06-01", to: "2026-06-17" });
    expect(presetRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-06-17" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-05-19", to: "2026-06-17" });
  });
});

describe("post-login redirect validation", () => {
  it("accepts ordinary in-app paths", () => {
    for (const ok of ["/dashboard", "/deliveries/abc123", "/vehicles?status=AVAILABLE", "/my-deliveries"]) expect(safeRedirectPath(ok)).toBe(ok);
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of [
      "//evil.example", "/\\evil.example", "/\\/evil.example", "https://evil.example", "http://evil.example/dashboard", "javascript:alert(1)",
      "evil.example", "/dashboard//evil.example", "/ evil", "", "/\tevil", "\\\\evil.example",
    ]) {
      expect(safeRedirectPath(bad), bad).toBeNull();
    }
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
  });
});
