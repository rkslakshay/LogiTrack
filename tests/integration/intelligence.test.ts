import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import type { ListQuery } from "@/lib/list";
import { explainChanges, getAnalytics } from "@/server/services/analytics";
import { changeDeliveryStatus, createDelivery, getDelivery, listDeliveries } from "@/server/services/deliveries";
import { createDriver } from "@/server/services/drivers";
import { createFuel } from "@/server/services/fuel";
import { fleetIntelligence, fuelIntelligence, maintenanceIntelligence, riskFor, riskOverview } from "@/server/services/intelligence";
import { completeMaintenance, createMaintenance } from "@/server/services/maintenance";
import { driverPerformance, leaderboard, performanceTrend } from "@/server/services/performance";
import { createVehicle } from "@/server/services/vehicles";
import { deliveryInput, driverInput, makeUser, prisma, resetDb, vehicleInput } from "../helpers";

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({ page: 1, pageSize: 100, skip: 0, q: "", sort: null, dir: "desc", from: null, to: null, ...overrides });
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const mins = (n: number) => new Date(Date.now() + n * 60_000);
const range = { from: days(-30), to: days(1) };

let manager: SessionUser;
let dispatcher: SessionUser;

beforeAll(async () => {
  await resetDb();
  manager = await makeUser("FLEET_MANAGER");
  dispatcher = await makeUser("DISPATCHER");
});

/** Inserts a closed delivery directly, at a chosen time, for analytics scenarios. */
async function history(opts: { driverId: string; vehicleId: string; daysAgo: number; status?: string; late?: boolean; km?: number }) {
  const scheduledAt = days(-opts.daysAgo);
  const expectedAt = new Date(scheduledAt.getTime() + 3 * 3600_000);
  const pickedUpAt = new Date(scheduledAt.getTime() + 600_000);
  const status = opts.status ?? "DELIVERED";
  const deliveredAt = status === "DELIVERED" ? new Date(expectedAt.getTime() + (opts.late ? 3600_000 : -3600_000)) : null;
  const n = await prisma.delivery.count();
  return prisma.delivery.create({
    data: {
      code: `HST-${n + 1}`, customerName: "History Ltd", customerPhone: "+91 98200 00000", pickupAddress: "A", destinationAddress: "B",
      pickupLat: 18.5, pickupLng: 73.8, destLat: 18.6, destLng: 73.9, driverId: opts.driverId, vehicleId: opts.vehicleId,
      scheduledAt, expectedAt, pickedUpAt, deliveredAt, closedAt: deliveredAt ?? expectedAt, distanceKm: opts.km ?? 25, estimatedMinutes: 60, status,
    },
  });
}

describe("delivery risk on live data", () => {
  it("attaches a risk assessment to open deliveries in lists and details, and none to closed ones", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    const open = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id, expectedAt: days(1) }));
    expect(open.risk).toMatchObject({ level: "LOW" });
    expect(open.risk!.reasons[0]).toMatch(/On track/);

    const closed = await createDelivery(dispatcher, deliveryInput());
    await changeDeliveryStatus(dispatcher, closed.id, { status: "CANCELLED", note: "test" });
    expect((await getDelivery(dispatcher, closed.id)).risk).toBeNull();

    const list = await listDeliveries(dispatcher, query(), {});
    expect(list.items.find((d) => d.id === open.id)!.risk?.level).toBe("LOW");
    expect(list.items.find((d) => d.id === closed.id)!.risk).toBeNull();
  });

  it("flags a moving delivery that cannot make its window, and explains why", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id, scheduledAt: mins(-30), expectedAt: mins(600) }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    // ~27 km to go at 40 km/h and 10x simulation: about 4 minutes. Give it 1.
    await prisma.delivery.update({ where: { id: d.id }, data: { expectedAt: mins(1), progress: 0 } });

    const detail = await getDelivery(dispatcher, d.id);
    expect(detail.risk).toMatchObject({ level: "HIGH" });
    expect(detail.risk!.reasons[0]).toMatch(/^Projected to arrive \d+ min after the expected time$/);
    expect(detail.risk!.slackMinutes).toBeLessThan(0);

    const overview = await riskOverview();
    expect(overview.items[0].risk.level).toBe("HIGH"); // riskiest first
    expect(overview.counts.high).toBeGreaterThanOrEqual(1);
    expect(overview.counts.total).toBe(overview.counts.high + overview.counts.medium + overview.counts.low);
    // Risk is advisory: computing it never changes the delivery.
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("IN_TRANSIT");
  });

  it("flags an unassigned delivery whose start time has passed", async () => {
    const d = await createDelivery(dispatcher, deliveryInput({ scheduledAt: mins(-40), expectedAt: days(1) }));
    const risk = (await riskFor([await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })])).get(d.id)!;
    expect(risk.level).toBe("MEDIUM");
    expect(risk.reasons[0]).toMatch(/Scheduled start passed 4\d min ago and no driver is assigned/);
  });

  it("uses the driver's recent punctuality once there is enough history", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    for (let i = 1; i <= 6; i++) await history({ driverId: driver.id, vehicleId: vehicle.id, daysAgo: i, late: i <= 5 });
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id, scheduledAt: mins(30), expectedAt: days(2) }));
    const risk = (await getDelivery(dispatcher, d.id)).risk!;
    expect(risk.level).toBe("MEDIUM");
    expect(risk.reasons.join(" ")).toMatch(/on time for only 17% of their last 6 deliveries/);
  });
});

describe("fleet utilisation service", () => {
  it("reports utilisation, downtime and under-used vehicles from stored records", async () => {
    await resetDb();
    manager = await makeUser("FLEET_MANAGER");
    dispatcher = await makeUser("DISPATCHER");
    const driver = await createDriver(manager, driverInput());
    const busy = await createVehicle(manager, vehicleInput({ registrationNumber: "MH 12 UT 0001" }));
    const idle = await createVehicle(manager, vehicleInput({ registrationNumber: "MH 12 UT 0002" }));
    const retired = await createVehicle(manager, vehicleInput({ registrationNumber: "MH 12 UT 0003", status: "INACTIVE" }));
    // Vehicles must have existed for the whole period to be judged.
    await prisma.vehicle.updateMany({ data: { createdAt: days(-200) } });
    for (let i = 1; i <= 12; i++) await history({ driverId: driver.id, vehicleId: busy.id, daysAgo: i, km: 30 });
    const job = await createMaintenance(manager, {
      vehicleId: idle.id, type: "BRAKE", description: "Brake job", serviceDate: days(-6), nextServiceDate: null, nextServiceOdometer: null,
      odometer: null, cost: 1000, provider: "Garage", status: "IN_PROGRESS",
    });
    await completeMaintenance(manager, job.id, { cost: 1000, odometer: null, nextServiceDate: null, nextServiceOdometer: null });

    const intel = await fleetIntelligence(range);
    const by = Object.fromEntries(intel.vehicles.map((v) => [v.registrationNumber, v]));
    expect(by["MH 12 UT 0003"]).toBeUndefined(); // inactive vehicles are not part of the operational fleet
    expect(by["MH 12 UT 0001"]).toMatchObject({ activeDays: 12, deliveries: 12, delivered: 12, distanceKm: 360, underutilized: false });
    expect(by["MH 12 UT 0002"].activeDays).toBe(0);
    expect(by["MH 12 UT 0002"].downtimeDays).toBe(7); // six days ago through today
    expect(by["MH 12 UT 0002"].underutilized).toBe(true);
    expect(by["MH 12 UT 0002"].explanation).toMatch(/Not used on any of its \d+ available days/);
    expect(by["MH 12 UT 0002"].explanation).toMatch(/7 days of maintenance downtime are already excluded/);

    expect(intel.fleet.operationalVehicles).toBe(2);
    expect(intel.fleet.activeVehicleShare).toBe(0.5);
    expect(intel.fleet.downtimeDays).toBe(7);
    expect(intel.fleet.distanceKm).toBe(360);
    expect(intel.fleet.avgDistancePerVehicle).toBe(180);
    expect(intel.fleet.underutilizedCount).toBe(1);
    expect(intel.trend.reduce((s, w) => s + w.vehiclesUsed, 0)).toBeGreaterThanOrEqual(2);
    void retired;
  });
});

describe("fuel intelligence service", () => {
  it("flags a mileage drop, incomplete records and leaves electric vehicles out", async () => {
    const drop = await createVehicle(manager, vehicleInput({ registrationNumber: "KA 01 FL 0001", odometer: 10_000, fuelCapacity: 80 }));
    const single = await createVehicle(manager, vehicleInput({ registrationNumber: "KA 01 FL 0002", odometer: 5_000 }));
    const electric = await createVehicle(manager, vehicleInput({ registrationNumber: "KA 01 FL 0003", fuelType: "ELECTRIC" }));
    const litres = [40, 50, 50, 50, 72, 74];
    for (let i = 0; i < litres.length; i++) {
      await createFuel(manager, { vehicleId: drop.id, date: days(-60 + i * 10), quantityL: litres[i], pricePerLitre: 90, odometer: 10_000 + i * 500, station: "Pump", notes: null });
    }
    await createFuel(manager, { vehicleId: single.id, date: days(-3), quantityL: 30, pricePerLitre: 90, odometer: 5_000, station: "Pump", notes: null });

    const intel = await fuelIntelligence({ from: days(-90), to: days(1) });
    const by = Object.fromEntries(intel.vehicles.map((v) => [v.registrationNumber, v]));
    expect(by["KA 01 FL 0001"].mileageKmPerL).toBeCloseTo(2500 / 296, 4);
    expect(by["KA 01 FL 0001"].intervalCount).toBe(5);
    expect(by["KA 01 FL 0001"].flags.map((f) => f.code)).toContain("MILEAGE_DROP");
    expect(by["KA 01 FL 0002"].mileageKmPerL).toBeNull();
    expect(by["KA 01 FL 0002"].flags[0].code).toBe("INSUFFICIENT_DATA");
    expect(by["KA 01 FL 0003"]).toBeUndefined();
    expect(intel.electric.map((e) => e.registrationNumber)).toEqual(["KA 01 FL 0003"]);
    expect(intel.summary.mileageDrops).toBe(1);
    expect(intel.summary.incomplete).toBeGreaterThanOrEqual(1);
    expect(intel.trend.length).toBeGreaterThanOrEqual(2);
    void electric;
  });
});

describe("maintenance recommendation service", () => {
  it("recommends from history and usage, and steps back when a person has planned the work", async () => {
    const noHistory = await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 MR 0001" }));
    const dueSoon = await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 MR 0002", odometer: 60_000 }));
    const planned = await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 MR 0003", odometer: 60_000 }));
    const booked = await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 MR 0004" }));

    const service = (vehicleId: string, followUp: boolean) =>
      prisma.maintenanceRecord.create({
        data: {
          code: `MNT-R-${vehicleId.slice(-5)}`, vehicleId, type: "GENERAL_SERVICE", description: "Service", serviceDate: days(-170), completedAt: days(-170),
          status: "COMPLETED", odometer: 51_000, provider: "Garage", nextServiceDate: followUp ? days(40) : null,
        },
      });
    await service(dueSoon.id, false);
    await service(planned.id, true);
    await createMaintenance(manager, {
      vehicleId: booked.id, type: "OIL_CHANGE", description: "Oil change", serviceDate: days(5), nextServiceDate: null, nextServiceOdometer: null,
      odometer: null, cost: 0, provider: "Garage", status: "SCHEDULED",
    });

    const { recommendations } = await maintenanceIntelligence();
    const by = Object.fromEntries(recommendations.map((r) => [r.registrationNumber, r]));
    expect(by["TN 09 MR 0001"]).toMatchObject({ basis: "NO_HISTORY", urgency: "SOON" });
    // 170 of 180 days used up, 9,000 of 10,000 km.
    expect(by["TN 09 MR 0002"]).toMatchObject({ urgency: "SOON", kmSinceService: 9000, daysSinceService: 170 });
    expect(by["TN 09 MR 0002"].dueInDays).toBeLessThanOrEqual(10);
    expect(by["TN 09 MR 0003"]).toBeUndefined(); // follow-up planned by a person
    expect(by["TN 09 MR 0004"]).toBeUndefined(); // routine job already scheduled
    // Most urgent first.
    const order = { OVERDUE: 0, SOON: 1, PLANNED: 2 };
    const urgencies = recommendations.map((r) => order[r.urgency]);
    expect([...urgencies].sort((a, b) => a - b)).toEqual(urgencies);
    void noHistory;
  });
});

describe("analytics comparison", () => {
  it("compares two periods, computes the deltas and explains the changes from the records", async () => {
    await resetDb();
    manager = await makeUser("FLEET_MANAGER");
    dispatcher = await makeUser("DISPATCHER");
    const slow = await createDriver(manager, driverInput({ fullName: "Slow Sam" }));
    const steady = await createDriver(manager, driverInput({ fullName: "Steady Asha" }));
    const v1 = await createVehicle(manager, vehicleInput());
    const v2 = await createVehicle(manager, vehicleInput());
    // Previous 30 days: 10 deliveries, all on time. Current 30 days: 12 deliveries, 5 late (4 of them by one driver).
    for (let i = 0; i < 10; i++) await history({ driverId: steady.id, vehicleId: v1.id, daysAgo: 35 + i });
    for (let i = 0; i < 7; i++) await history({ driverId: steady.id, vehicleId: v1.id, daysAgo: 2 + i, late: i === 0 });
    for (let i = 0; i < 5; i++) await history({ driverId: slow.id, vehicleId: v2.id, daysAgo: 3 + i, late: i < 4 });

    const current = { from: days(-30), to: days(0) };
    const result = await getAnalytics(current, "previous");
    expect(result.comparison).not.toBeNull();
    expect(result.summary.delivered).toBe(12);
    expect(result.comparison!.summary.delivered).toBe(10);
    expect(result.deltas!.delivered).toMatchObject({ current: 12, previous: 10, change: 2 });
    expect(result.deltas!.delivered.pct).toBeCloseTo(0.2, 9);
    expect(result.summary.onTimeRate).toBe(58.3);
    expect(result.comparison!.summary.onTimeRate).toBe(100);
    expect(result.deltas!.onTimeRate.change).toBeCloseTo(-41.7, 1);

    const onTime = result.insights.find((s) => s.startsWith("On-time delivery"))!;
    expect(onTime).toBe("On-time delivery dropped from 100% to 58.3%: 5 of 12 deliveries were late, against 0 of 10 before. Slow Sam accounts for 4 of the 5 late deliveries.");
    // Two more deliveries is below the reporting threshold (10% and at least 3), so volume is not called out.
    expect(result.insights.some((s) => s.startsWith("Delivery volume"))).toBe(false);
    expect(result.lateByDriver[0]).toMatchObject({ name: "Slow Sam", late: 4 });
    expect(result.productivity).toMatchObject({ activeDrivers: 2, deliveredPerDriver: 6 });

    // Without a comparison nothing extra is computed.
    const plain = await getAnalytics(current);
    expect(plain.comparison).toBeNull();
    expect(plain.deltas).toBeNull();
    expect(plain.insights).toEqual([]);
  });

  it("says so when the comparison period is empty instead of inventing a change", async () => {
    const result = await getAnalytics({ from: days(-30), to: days(0) }, "year");
    expect(result.comparison!.summary.totalDeliveries).toBe(0);
    expect(result.insights).toEqual(["There were no deliveries in the comparison period, so changes cannot be calculated."]);
  });

  it("reports when nothing significant changed", async () => {
    const a = await getAnalytics({ from: days(-30), to: days(0) }, "previous");
    const same = explainChanges(a as never, a as never, Object.fromEntries(Object.keys(a.deltas!).map((k) => [k, { current: 1, previous: 1, change: 0, pct: 0 }])) as never);
    expect(same).toEqual(["No significant changes against the comparison period: the main metrics moved by less than the reporting thresholds."]);
  });

  it("breaks maintenance cost down by type", async () => {
    const v = await createVehicle(manager, vehicleInput());
    for (const [type, cost] of [["TYRE", 20_000], ["TYRE", 15_000], ["BRAKE", 4_000]] as const) {
      await prisma.maintenanceRecord.create({
        data: { code: `MNT-A-${type}-${cost}`, vehicleId: v.id, type, description: "x", serviceDate: days(-5), completedAt: days(-5), status: "COMPLETED", costPaise: cost * 100, provider: "G" },
      });
    }
    const result = await getAnalytics({ from: days(-30), to: days(0) });
    expect(result.maintenanceByType[0]).toMatchObject({ type: "TYRE", label: "Tyre Replacement", costPaise: 3_500_000, count: 2 });
    expect(result.maintenanceByType.reduce((s, t) => s + t.costPaise, 0)).toBe(result.summary.maintenanceCostPaise);
  });
});

describe("driver performance intelligence", () => {
  it("reports a 30-day trend only with enough deliveries in both windows", async () => {
    await resetDb();
    manager = await makeUser("FLEET_MANAGER");
    const improving = await createDriver(manager, driverInput({ fullName: "Improving Driver" }));
    const sparse = await createDriver(manager, driverInput({ fullName: "Sparse Driver" }));
    const v = await createVehicle(manager, vehicleInput());
    for (let i = 0; i < 4; i++) await history({ driverId: improving.id, vehicleId: v.id, daysAgo: 40 + i, late: i < 3 }); // 25% on time
    for (let i = 0; i < 4; i++) await history({ driverId: improving.id, vehicleId: v.id, daysAgo: 3 + i }); // 100% on time
    await history({ driverId: sparse.id, vehicleId: v.id, daysAgo: 4 });

    const board = await leaderboard(days(-90), days(0));
    const up = board.rows.find((r) => r.driver.id === improving.id)!;
    expect(up.trend).toMatchObject({ direction: "up", recent: { delivered: 4, onTimeRate: 1 }, previous: { delivered: 4, onTimeRate: 0.25 } });
    expect(up.trend.onTimeChange).toBeCloseTo(0.75, 9);
    const few = board.rows.find((r) => r.driver.id === sparse.id)!;
    expect(few.trend.direction).toBeNull(); // one delivery is not a trend
    expect(few.stats.score).toBeNull(); // and not enough to be ranked
    expect(few.rank).toBeNull();

    // Fleet benchmark: 9 delivered, 6 on time.
    expect(board.fleet).toMatchObject({ delivered: 9, deliveredPerDriver: 4.5 });
    expect(board.fleet.onTimeRate).toBeCloseTo(6 / 9, 9);
    expect(up.stats.completionRate).toBe(1);

    const own = await driverPerformance(manager, improving.id, days(-90), days(0));
    expect(own.trend.direction).toBe("up");
    expect(own.fleet.delivered).toBe(9);
  });

  it("calls small movements flat", () => {
    const d = (daysAgo: number, late: boolean) => {
      const scheduledAt = days(-daysAgo);
      const expectedAt = new Date(scheduledAt.getTime() + 3600_000);
      return { status: "DELIVERED", scheduledAt, expectedAt, pickedUpAt: scheduledAt, deliveredAt: new Date(expectedAt.getTime() + (late ? 60_000 : -60_000)), distanceKm: 10 };
    };
    const rows = [...Array.from({ length: 10 }, (_, i) => d(35 + i, i === 0)), ...Array.from({ length: 10 }, (_, i) => d(2 + i, i === 0))];
    expect(performanceTrend(rows, new Date()).direction).toBe("flat");
  });
});
