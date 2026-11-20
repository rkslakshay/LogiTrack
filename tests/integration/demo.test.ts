import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, getUserByToken, verifyPassword, type SessionUser } from "@/lib/auth";
import { demoStatus, isDemoMode, resetDemoData, restartDemoTrips } from "@/server/demo";
import { DEMO_LOGINS, seedDemoData } from "@/server/demo/seed";
import { getAnalytics } from "@/server/services/analytics";
import { fleetIntelligence, fuelIntelligence, maintenanceIntelligence, riskOverview } from "@/server/services/intelligence";
import { complianceAlerts, maintenanceAlerts } from "@/server/services/maintenance";
import { leaderboard } from "@/server/services/performance";
import { getSimulator } from "@/server/simulator";
import { prisma, resetDb } from "../helpers";

const days = (n: number) => new Date(Date.now() + n * 86_400_000);
let admin: SessionUser;

async function actorFor(email: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { driver: true } });
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role as SessionUser["role"], driverId: u.driver?.id ?? null };
}

beforeAll(async () => {
  await resetDb();
  await seedDemoData();
  admin = await actorFor("admin@logitrack.in");
});
afterAll(() => {
  getSimulator().pause();
  process.env.DEMO_MODE = "true";
});

describe("demo dataset", () => {
  it("meets the minimum sizes and covers every status", async () => {
    const [vehicles, drivers, deliveries, fuel, maintenance, notifications, activity] = await Promise.all([
      prisma.vehicle.count(), prisma.driver.count(), prisma.delivery.count(), prisma.fuelRecord.count(), prisma.maintenanceRecord.count(),
      prisma.notification.count(), prisma.activityLog.count(),
    ]);
    expect(vehicles).toBeGreaterThanOrEqual(15);
    expect(drivers).toBeGreaterThanOrEqual(12);
    expect(deliveries).toBeGreaterThanOrEqual(30);
    expect(fuel).toBeGreaterThan(50);
    expect(maintenance).toBeGreaterThan(15);
    expect(notifications).toBeGreaterThan(10);
    expect(activity).toBeGreaterThan(100);

    const statuses = (await prisma.delivery.groupBy({ by: ["status"] })).map((s) => s.status).sort();
    expect(statuses).toEqual(["ASSIGNED", "CANCELLED", "DELAYED", "DELIVERED", "FAILED", "IN_TRANSIT", "PENDING", "PICKED_UP"]);
    expect((await prisma.vehicle.groupBy({ by: ["status"] })).map((s) => s.status).sort()).toEqual(["AVAILABLE", "INACTIVE", "MAINTENANCE", "ON_DELIVERY"]);
    expect((await prisma.vehicle.groupBy({ by: ["type"] })).length).toBeGreaterThanOrEqual(5);
    expect((await prisma.driver.groupBy({ by: ["status"] })).map((s) => s.status).sort()).toEqual(["AVAILABLE", "INACTIVE", "OFF_DUTY", "ON_DELIVERY"]);
  });

  it("provides a working login for each of the four roles", async () => {
    expect(DEMO_LOGINS.map((l) => l.role)).toEqual(["SUPER_ADMIN", "FLEET_MANAGER", "DISPATCHER", "DRIVER"]);
    for (const login of DEMO_LOGINS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: login.email }, include: { driver: true } });
      expect(user.role).toBe(login.role);
      expect(user.isActive).toBe(true);
      expect(await verifyPassword(login.password, user.passwordHash)).toBe(true);
      if (login.role === "DRIVER") expect(user.driver).not.toBeNull();
    }
  });

  it("keeps driver and vehicle availability consistent with the deliveries on the road", async () => {
    const active = await prisma.delivery.findMany({ where: { status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"] } }, include: { driver: true, vehicle: true } });
    expect(active.length).toBeGreaterThanOrEqual(6);
    for (const d of active) {
      expect(d.driver?.status, d.code).toBe("ON_DELIVERY");
      expect(d.vehicle?.status, d.code).toBe("ON_DELIVERY");
    }
    // Nobody is marked busy without an active delivery.
    const busyDrivers = await prisma.driver.findMany({ where: { status: "ON_DELIVERY" } });
    expect(busyDrivers.map((d) => d.id).sort()).toEqual([...new Set(active.map((d) => d.driverId!))].sort());
    const busyVehicles = await prisma.vehicle.findMany({ where: { status: "ON_DELIVERY" } });
    expect(busyVehicles.map((v) => v.id).sort()).toEqual([...new Set(active.map((d) => d.vehicleId!))].sort());
  });

  it("showcases every intelligence feature with real records", async () => {
    const range = { from: days(-30), to: days(1) };
    const risk = await riskOverview();
    expect(risk.counts.high).toBeGreaterThanOrEqual(1);
    expect(risk.counts.medium).toBeGreaterThanOrEqual(1);
    expect(risk.counts.low).toBeGreaterThanOrEqual(1);

    const fleet = await fleetIntelligence(range);
    expect(fleet.fleet.underutilizedCount).toBeGreaterThanOrEqual(1);
    expect(fleet.fleet.underutilizedCount).toBeLessThan(fleet.fleet.operationalVehicles / 2); // most of the fleet is working
    expect(fleet.fleet.utilization).toBeGreaterThan(0.08);

    const fuel = await fuelIntelligence({ from: days(-180), to: days(1) });
    const codes = new Set(fuel.vehicles.flatMap((v) => v.flags.map((f) => f.code)));
    expect(codes.has("MILEAGE_DROP")).toBe(true);
    expect(codes.has("INSUFFICIENT_DATA")).toBe(true);
    expect(fuel.electric.length).toBe(1);

    expect((await maintenanceIntelligence()).recommendations.length).toBeGreaterThanOrEqual(1);
    const alerts = await maintenanceAlerts();
    expect(alerts.some((a) => a.state === "OVERDUE")).toBe(true);
    expect(alerts.some((a) => a.state === "DUE_SOON")).toBe(true);
    const compliance = await complianceAlerts();
    expect(new Set(compliance.map((c) => c.kind))).toEqual(new Set(["INSURANCE", "REGISTRATION", "LICENSE"]));

    const board = await leaderboard(days(-180), days(1));
    expect(board.rows.filter((r) => r.rank != null).length).toBeGreaterThanOrEqual(8);
    expect(board.rows.some((r) => r.trend.direction != null)).toBe(true);

    const analytics = await getAnalytics(range, "previous");
    expect(analytics.summary.delivered).toBeGreaterThan(20);
    expect(analytics.comparison!.summary.delivered).toBeGreaterThan(20);
    expect(analytics.insights.length).toBeGreaterThanOrEqual(1);
  });
});

describe("demo reset", () => {
  it("rebuilds the same dataset and keeps demo accounts signed in", async () => {
    const before = {
      userIds: (await prisma.user.findMany({ orderBy: { email: "asc" } })).map((u) => `${u.email}:${u.id}`),
      vehicles: (await prisma.vehicle.findMany({ orderBy: { code: "asc" } })).map((v) => `${v.code}:${v.registrationNumber}:${v.status}`),
      drivers: (await prisma.driver.findMany({ orderBy: { code: "asc" } })).map((d) => `${d.code}:${d.fullName}:${d.status}`),
      deliveries: await prisma.delivery.count(),
      customers: (await prisma.delivery.findMany({ orderBy: { code: "asc" }, take: 40 })).map((d) => `${d.code}:${d.customerName}:${d.status}`),
    };
    const session = await createSession(admin.id);

    // A visitor makes a mess: extra account, a deactivated demo login, edited and deleted records.
    const extra = await prisma.user.create({ data: { name: "Visitor", email: "visitor@test.in", role: "DISPATCHER", passwordHash: "x" } });
    const extraSession = await createSession(extra.id);
    await prisma.user.update({ where: { email: "dispatcher@logitrack.in" }, data: { isActive: false, name: "Renamed" } });
    await prisma.vehicle.updateMany({ data: { name: "Vandalised" } });
    await prisma.notification.deleteMany();

    const summary = await resetDemoData(admin);
    expect(summary.deliveries).toBe(before.deliveries);

    expect((await prisma.user.findMany({ orderBy: { email: "asc" } })).map((u) => `${u.email}:${u.id}`)).toEqual(before.userIds);
    expect((await prisma.vehicle.findMany({ orderBy: { code: "asc" } })).map((v) => `${v.code}:${v.registrationNumber}:${v.status}`)).toEqual(before.vehicles);
    expect((await prisma.driver.findMany({ orderBy: { code: "asc" } })).map((d) => `${d.code}:${d.fullName}:${d.status}`)).toEqual(before.drivers);
    expect((await prisma.delivery.findMany({ orderBy: { code: "asc" }, take: 40 })).map((d) => `${d.code}:${d.customerName}:${d.status}`)).toEqual(before.customers);
    expect(await prisma.vehicle.count({ where: { name: "Vandalised" } })).toBe(0);
    expect(await prisma.notification.count()).toBeGreaterThan(10);

    // The person who pressed reset is still signed in; the visitor's account and session are gone.
    expect((await getUserByToken(session.token))?.id).toBe(admin.id);
    expect(await getUserByToken(extraSession.token)).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: "visitor@test.in" } })).toBeNull();
    const dispatcher = await prisma.user.findUniqueOrThrow({ where: { email: "dispatcher@logitrack.in" } });
    expect(dispatcher).toMatchObject({ isActive: true, name: "Rohan Verma" });

    // The reset itself is on the audit trail, and the generation time is recorded for the banner.
    expect(await prisma.activityLog.count({ where: { entityType: "Demo", userId: admin.id } })).toBe(1);
    const status = await demoStatus();
    expect(status.enabled).toBe(true);
    expect(Date.now() - new Date(status.seededAt!).getTime()).toBeLessThan(60_000);
  });

  it("rewinds the trips on the road when the simulation is restarted", async () => {
    const moving = await prisma.delivery.findMany({ where: { status: { in: ["IN_TRANSIT", "DELAYED"] }, pickedUpAt: { not: null } } });
    expect(moving.length).toBeGreaterThanOrEqual(4);
    expect(moving.some((d) => d.progress > 0)).toBe(true);

    const result = await restartDemoTrips(admin);
    expect(result.restarted).toBe(moving.length);
    expect(result.simulator.running).toBe(true);
    getSimulator().pause();

    for (const d of moving) {
      const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id }, include: { vehicle: true } });
      expect(after.progress).toBe(0);
      expect(after.status).toBe(d.status); // rewinding does not change the workflow state
      expect(after.vehicle!.lastLat).toBeCloseTo(d.pickupLat, 3);
      expect(after.vehicle!.lastLng).toBeCloseTo(d.pickupLng, 3);
    }
  });

  it("is unavailable outside demo mode", async () => {
    process.env.DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
    const count = await prisma.delivery.count();
    await expect(resetDemoData(admin)).rejects.toMatchObject({ status: 403 });
    await expect(restartDemoTrips(admin)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.delivery.count()).toBe(count);
    expect((await demoStatus()).enabled).toBe(false);
    process.env.DEMO_MODE = "true";
  });
});

describe("simulator viewer gate", () => {
  it("idles while nobody is watching and resumes when someone is", async () => {
    const { GpsSimulator } = await import("@/server/simulator");
    const simulator = new GpsSimulator(40);
    let viewers = 0;
    simulator.setGate(() => viewers > 0);
    const target = await prisma.delivery.findFirstOrThrow({ where: { status: "IN_TRANSIT" } });
    const progress = async () => (await prisma.delivery.findUniqueOrThrow({ where: { id: target.id } })).progress;
    const start = await progress();

    simulator.start();
    await new Promise((r) => setTimeout(r, 400));
    expect(simulator.state()).toMatchObject({ running: true, waitingForViewers: true });
    expect(await progress()).toBe(start); // no viewers: the trip did not advance

    viewers = 1;
    await new Promise((r) => setTimeout(r, 600));
    simulator.pause();
    expect(await progress()).toBeGreaterThan(start);
    expect(simulator.state().waitingForViewers).toBe(false);
  });
});
