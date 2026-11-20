import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import type { ListQuery } from "@/lib/list";
import { getAnalytics, getDashboard } from "@/server/services/analytics";
import { changeDeliveryStatus, createDelivery } from "@/server/services/deliveries";
import { createDriver } from "@/server/services/drivers";
import { createFuel, deleteFuel, fuelSummary, listFuel, updateFuel } from "@/server/services/fuel";
import {
  cancelMaintenance, completeMaintenance, complianceAlerts, createMaintenance, deleteMaintenance, maintenanceAlerts, startMaintenance,
} from "@/server/services/maintenance";
import { deleteNotification, listNotifications, markAllRead, markRead, notifyRoles, notifyUsers, unreadCount } from "@/server/services/notifications";
import { driverPerformance, leaderboard } from "@/server/services/performance";
import { runReminderSweep } from "@/server/services/reminders";
import { buildReport } from "@/server/services/reports";
import { assignRoute, createRoute, deleteRoute, getRouteById, pointToPoint, previewRoute } from "@/server/services/routes";
import { GpsSimulator } from "@/server/simulator";
import { fleetSnapshot } from "@/server/services/tracking";
import { getSettings, updateSettings } from "@/server/services/settings";
import { createVehicle } from "@/server/services/vehicles";
import { deliveryInput, driverInput, makeUser, prisma, resetDb, vehicleInput } from "../helpers";

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({ page: 1, pageSize: 50, skip: 0, q: "", sort: null, dir: "desc", from: null, to: null, ...overrides });
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const range = { from: days(-30), to: days(30) };

let admin: SessionUser;
let manager: SessionUser;
let dispatcher: SessionUser;

beforeAll(async () => {
  await resetDb();
  admin = await makeUser("SUPER_ADMIN");
  manager = await makeUser("FLEET_MANAGER");
  dispatcher = await makeUser("DISPATCHER");
});

const fuelInput = (vehicleId: string, overrides = {}) => ({
  vehicleId, date: days(-1), quantityL: 40, pricePerLitre: 92.5, odometer: 10_500, station: "HP Pump, Wakad", notes: null, ...overrides,
});

describe("fuel management", () => {
  it("stores money as paise and computes the total", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ odometer: 10_000 }));
    const record = await createFuel(manager, fuelInput(vehicle.id));
    expect(record.code).toMatch(/^FUEL-\d{4}$/);
    expect(record.pricePerLitrePaise).toBe(9250);
    expect(record.totalCostPaise).toBe(370_000); // 40 L x Rs 92.50
    // A newer reading moves the vehicle odometer forward.
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer).toBe(10_500);
    expect(await prisma.activityLog.count({ where: { entityType: "FuelRecord", entityId: record.id, action: "CREATE" } })).toBe(1);
  });

  it("rejects odometer readings that contradict neighbouring fills", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ odometer: 20_000 }));
    await createFuel(manager, fuelInput(vehicle.id, { date: days(-10), odometer: 20_400 }));
    await createFuel(manager, fuelInput(vehicle.id, { date: days(-2), odometer: 21_000 }));
    await expect(createFuel(manager, fuelInput(vehicle.id, { date: days(-1), odometer: 20_900 }))).rejects.toMatchObject({
      status: 409, fieldErrors: { odometer: expect.stringContaining("cannot be lower") },
    });
    await expect(createFuel(manager, fuelInput(vehicle.id, { date: days(-5), odometer: 21_500 }))).rejects.toThrow(/cannot be higher/);
    await expect(createFuel(manager, fuelInput(vehicle.id, { date: days(-5), odometer: 20_700 }))).resolves.toBeTruthy();
  });

  it("rejects a quantity larger than the tank", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ fuelCapacity: 30 }));
    await expect(createFuel(manager, fuelInput(vehicle.id, { quantityL: 45 }))).rejects.toMatchObject({ fieldErrors: { quantityL: expect.any(String) } });
  });

  it("computes spend, mileage and cost per km from saved records", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ odometer: 30_000, fuelCapacity: 60 }));
    await createFuel(manager, fuelInput(vehicle.id, { date: days(-20), odometer: 30_000, quantityL: 40, pricePerLitre: 90 }));
    await createFuel(manager, fuelInput(vehicle.id, { date: days(-10), odometer: 30_600, quantityL: 50, pricePerLitre: 92 }));
    const last = await createFuel(manager, fuelInput(vehicle.id, { date: days(-1), odometer: 31_140, quantityL: 45, pricePerLitre: 94 }));

    const summary = await fuelSummary(query(), { vehicleId: vehicle.id });
    expect(summary.totals.fillCount).toBe(3);
    expect(summary.totals.totalLitres).toBe(135);
    expect(summary.totals.totalCostPaise).toBe(360_000 + 460_000 + 423_000);
    expect(summary.totals.mileageKmPerL).toBeCloseTo(1140 / 95, 6);
    expect(summary.totals.costPerKmPaise).toBeCloseTo((460_000 + 423_000) / 1140, 6);
    expect(summary.vehicles).toHaveLength(1);
    expect(summary.monthly.reduce((s, m) => s + m.costPaise, 0)).toBe(summary.totals.totalCostPaise);

    // Editing and deleting flow straight into the analytics.
    await updateFuel(manager, last.id, fuelInput(vehicle.id, { date: days(-1), odometer: 31_140, quantityL: 45, pricePerLitre: 100 }));
    expect((await fuelSummary(query(), { vehicleId: vehicle.id })).totals.totalCostPaise).toBe(360_000 + 460_000 + 450_000);
    await deleteFuel(manager, last.id);
    const after = await fuelSummary(query(), { vehicleId: vehicle.id });
    expect(after.totals.fillCount).toBe(2);
    expect(after.totals.mileageKmPerL).toBeCloseTo(600 / 50, 6);
  });

  it("filters fuel history by vehicle, date and text", async () => {
    const vehicle = await createVehicle(manager, vehicleInput());
    await createFuel(manager, fuelInput(vehicle.id, { station: "Shell Bannerghatta Unique" }));
    expect((await listFuel(query(), { vehicleId: vehicle.id })).total).toBe(1);
    expect((await listFuel(query({ q: "Bannerghatta Unique" }), {})).total).toBe(1);
    expect((await listFuel(query({ from: days(5) }), { vehicleId: vehicle.id })).total).toBe(0);
  });
});

const maintenanceInput = (vehicleId: string, overrides = {}) => ({
  vehicleId, type: "OIL_CHANGE" as const, description: "Engine oil change", serviceDate: days(3), nextServiceDate: null, nextServiceOdometer: null,
  odometer: null, cost: 2500, provider: "Test Garage", status: "SCHEDULED" as const, ...overrides,
});

describe("maintenance management", () => {
  it("takes the vehicle out of service while work is in progress and returns it on completion", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ odometer: 40_000 }));
    const status = async () => (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status;
    const job = await createMaintenance(manager, maintenanceInput(vehicle.id));
    expect(job.code).toMatch(/^MNT-\d{4}$/);
    expect(await status()).toBe("AVAILABLE"); // scheduling alone does not block the vehicle

    await startMaintenance(manager, job.id);
    expect(await status()).toBe("MAINTENANCE");

    const done = await completeMaintenance(manager, job.id, { cost: 3100.5, odometer: 40_250, nextServiceDate: days(180), nextServiceOdometer: 50_000 });
    expect(done.status).toBe("COMPLETED");
    expect(done.costPaise).toBe(310_050);
    expect(done.completedAt).not.toBeNull();
    expect(await status()).toBe("AVAILABLE");
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer).toBe(40_250);
    expect(await prisma.activityLog.count({ where: { entityId: job.id, action: "COMPLETE" } })).toBe(1);
    // Managers are told when the vehicle leaves and re-enters service.
    expect(await prisma.notification.count({ where: { userId: manager.id, category: "VEHICLE", entityId: vehicle.id } })).toBe(2);
  });

  it("keeps the vehicle in maintenance until every job in progress is closed", async () => {
    const vehicle = await createVehicle(manager, vehicleInput());
    const a = await createMaintenance(manager, maintenanceInput(vehicle.id, { status: "IN_PROGRESS" }));
    const b = await createMaintenance(manager, maintenanceInput(vehicle.id, { type: "BRAKE", status: "IN_PROGRESS" }));
    const status = async () => (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status;
    await completeMaintenance(manager, a.id, { cost: 100, odometer: null, nextServiceDate: null, nextServiceOdometer: null });
    expect(await status()).toBe("MAINTENANCE");
    await cancelMaintenance(manager, b.id);
    expect(await status()).toBe("AVAILABLE");
  });

  it("will not start maintenance on a vehicle that is out on a delivery", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    const job = await createMaintenance(manager, maintenanceInput(vehicle.id));
    await expect(startMaintenance(manager, job.id)).rejects.toThrow(/on a delivery/);
  });

  it("guards completion rules", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ odometer: 60_000 }));
    const job = await createMaintenance(manager, maintenanceInput(vehicle.id));
    await expect(completeMaintenance(manager, job.id, { cost: 1, odometer: 60_100, nextServiceDate: null, nextServiceOdometer: 60_050 })).rejects.toThrow(/greater than the current reading/);
    await expect(completeMaintenance(manager, job.id, { cost: 1, odometer: null, nextServiceDate: days(-1), nextServiceOdometer: null })).rejects.toThrow(/future/);
    await completeMaintenance(manager, job.id, { cost: 1, odometer: null, nextServiceDate: null, nextServiceOdometer: null });
    await expect(completeMaintenance(manager, job.id, { cost: 1, odometer: null, nextServiceDate: null, nextServiceOdometer: null })).rejects.toThrow(/already completed/);
    await expect(deleteMaintenance(manager, job.id)).rejects.toThrow(/service history/);
  });

  it("raises reminders from service dates and odometer thresholds", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ registrationNumber: "GJ 01 RM 4321", odometer: 70_000 }));
    const mine = async () => (await maintenanceAlerts()).filter((a) => a.vehicleId === vehicle.id);

    const soon = await createMaintenance(manager, maintenanceInput(vehicle.id, { serviceDate: days(3) }));
    expect(await mine()).toMatchObject([{ state: "DUE_SOON", recordId: soon.id, followUp: false }]);

    await prisma.maintenanceRecord.update({ where: { id: soon.id }, data: { serviceDate: days(-4) } });
    expect((await mine())[0]).toMatchObject({ state: "OVERDUE" });
    expect((await mine())[0].reason).toMatch(/4 days ago/);

    // Completing it with an odometer-based follow-up: no alert until the vehicle gets close.
    await completeMaintenance(manager, soon.id, { cost: 2000, odometer: 70_000, nextServiceDate: days(200), nextServiceOdometer: 75_000 });
    expect(await mine()).toHaveLength(0);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { odometer: 74_700 } });
    expect(await mine()).toMatchObject([{ state: "DUE_SOON", followUp: true }]);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { odometer: 75_300 } });
    expect((await mine())[0].state).toBe("OVERDUE");

    // Booking the follow-up job replaces the follow-up reminder with the job's own schedule.
    await createMaintenance(manager, maintenanceInput(vehicle.id, { serviceDate: days(40) }));
    expect(await mine()).toHaveLength(0);
  });

  it("reports insurance, registration and licence expiries", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ insuranceExpiry: days(10), registrationExpiry: days(-2) }));
    const driver = await createDriver(manager, driverInput({ licenseExpiry: days(20) }));
    const alerts = await complianceAlerts();
    expect(alerts.find((a) => a.id === `INSURANCE:${vehicle.id}`)).toMatchObject({ state: "DUE_SOON", days: 10 });
    expect(alerts.find((a) => a.id === `REGISTRATION:${vehicle.id}`)).toMatchObject({ state: "OVERDUE" });
    expect(alerts.find((a) => a.id === `LICENSE:${driver.id}`)).toMatchObject({ state: "DUE_SOON", kind: "LICENSE" });
  });
});

describe("notifications", () => {
  it("persists notifications per user with read state", async () => {
    const user = await makeUser("DISPATCHER");
    await notifyUsers(prisma, [user.id], { category: "SYSTEM", title: "Hello", message: "First" });
    await notifyUsers(prisma, [user.id], { category: "DELIVERY", severity: "WARNING", title: "Delay", message: "Second" });
    expect(await unreadCount(user.id)).toBe(2);

    const list = await listNotifications(user.id, query(), {});
    expect(list.items.map((n) => n.title)).toEqual(["Delay", "Hello"]); // newest first
    expect((await listNotifications(user.id, query(), { category: "DELIVERY" })).total).toBe(1);

    await markRead(user.id, list.items[0].id);
    expect(await unreadCount(user.id)).toBe(1);
    expect((await listNotifications(user.id, query(), { unread: true })).total).toBe(1);
    await markRead(user.id, list.items[0].id, false);
    expect(await unreadCount(user.id)).toBe(2);
    await markAllRead(user.id);
    expect(await unreadCount(user.id)).toBe(0);
    await deleteNotification(user.id, list.items[0].id);
    expect((await listNotifications(user.id, query(), {})).total).toBe(1);
  });

  it("never lets one user read or change another user's notifications", async () => {
    const owner = await makeUser("DISPATCHER");
    const other = await makeUser("DISPATCHER");
    await notifyUsers(prisma, [owner.id], { category: "SYSTEM", title: "Private", message: "x" });
    const [note] = (await listNotifications(owner.id, query(), {})).items;
    expect((await listNotifications(other.id, query(), {})).total).toBe(0);
    await expect(markRead(other.id, note.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteNotification(other.id, note.id)).rejects.toMatchObject({ status: 404 });
    expect(await unreadCount(owner.id)).toBe(1);
  });

  it("targets roles and skips inactive users", async () => {
    const active = await makeUser("FLEET_MANAGER");
    const inactive = await makeUser("FLEET_MANAGER");
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    const driver = await makeUser("DRIVER");
    await notifyRoles(prisma, ["FLEET_MANAGER"], { category: "MAINTENANCE", title: "Role test", message: "x" });
    expect(await prisma.notification.count({ where: { userId: active.id, title: "Role test" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: inactive.id, title: "Role test" } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: driver.id, title: "Role test" } })).toBe(0);
  });

  it("deduplicates reminders so a sweep can run repeatedly", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ registrationNumber: "RJ 14 SW 5555", insuranceExpiry: days(5) }));
    const first = await runReminderSweep();
    expect(first.notificationsCreated).toBeGreaterThan(0);
    const mine = () => prisma.notification.count({ where: { userId: manager.id, entityId: vehicle.id, category: "COMPLIANCE" } });
    expect(await mine()).toBe(1);

    const second = await runReminderSweep();
    expect(second.notificationsCreated).toBe(0);
    expect(await mine()).toBe(1);
  });
});

describe("route planning", () => {
  const start = { label: "Peenya, Bengaluru", lat: 13.0285, lng: 77.5197 };
  const stop = (lat: number, lng: number, name: string) => deliveryInput({ pickupAddress: "Peenya Depot", pickupLat: 13.03, pickupLng: 77.52, destinationAddress: name, destLat: lat, destLng: lng });

  it("estimates a point-to-point trip", async () => {
    const result = await pointToPoint([19.076, 72.8777], [18.5204, 73.8567]);
    expect(result.straightLineKm).toBeGreaterThan(115);
    expect(result.options[0].source).toBe("local"); // offline fallback in tests
    expect(result.options[0].distanceKm).toBeCloseTo(result.straightLineKm * 1.3, 0);
    expect(result.options[0].estimatedMinutes).toBeGreaterThan(0);
    expect(result.options[0].geometry.length).toBeGreaterThan(2);
  });

  it("optimises a multi-stop route and never does worse than the entered order", async () => {
    const ids = [];
    for (const [lat, lng, name] of [[12.8452, 77.6602, "Electronic City"], [13.0234, 77.5501, "Yeshwanthpur"], [12.9857, 77.7369, "Whitefield"], [12.9352, 77.6245, "Koramangala"]] as const) {
      ids.push((await createDelivery(dispatcher, stop(lat, lng, name))).id);
    }
    const preview = await previewRoute({ start, deliveryIds: ids, strategy: "optimized" });
    const byStrategy = Object.fromEntries(preview.options.map((o) => [o.strategy, o.distanceKm]));
    expect(byStrategy.optimized).toBeLessThanOrEqual(byStrategy.original);
    expect(byStrategy.optimized).toBeLessThanOrEqual(byStrategy.nearestNeighbor);

    const { stops, stopCount } = preview.selected;
    expect(stopCount).toBe(8); // a pickup and a drop-off per delivery
    expect(stops[0].type).toBe("START");
    expect(stops.map((s) => s.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const id of ids) {
      const pickup = stops.find((s) => s.deliveryId === id && s.type === "PICKUP")!;
      const dropoff = stops.find((s) => s.deliveryId === id && s.type === "DROPOFF")!;
      expect(pickup.sequence).toBeLessThan(dropoff.sequence);
    }
    expect(preview.selected.distanceKm).toBeGreaterThan(0);
    expect(preview.selected.estimatedMinutes).toBeGreaterThan(80); // includes 10 min per stop
  });

  it("saves a route, assigns every delivery to one crew, and releases them when deleted", async () => {
    const a = await createDelivery(dispatcher, stop(12.9, 77.6, "Stop A"));
    const b = await createDelivery(dispatcher, stop(12.95, 77.7, "Stop B"));
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());

    const route = await createRoute(dispatcher, { start, deliveryIds: [a.id, b.id], strategy: "optimized", name: "South run", driverId: null, vehicleId: null });
    expect(route.code).toMatch(/^RTE-\d{4}$/);
    expect(route.status).toBe("PLANNED");
    expect(route.stops).toHaveLength(5);
    expect(route.deliveries.every((d) => d.status === "PENDING")).toBe(true);
    // A delivery cannot be planned into two routes.
    await expect(previewRoute({ start, deliveryIds: [a.id], strategy: "optimized" })).rejects.toThrow(/already part of another route/);

    const assigned = await assignRoute(dispatcher, route.id, { driverId: driver.id, vehicleId: vehicle.id });
    expect(assigned.deliveries.every((d) => d.status === "ASSIGNED")).toBe(true);
    expect(assigned.driver?.id).toBe(driver.id);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe("ON_DELIVERY");

    // Route status follows its deliveries.
    await changeDeliveryStatus(dispatcher, a.id, { status: "PICKED_UP" });
    expect((await getRouteById(route.id)).status).toBe("IN_PROGRESS");
    await expect(deleteRoute(dispatcher, route.id)).rejects.toThrow(/in progress/);
    for (const id of [a.id, b.id]) {
      if (id === b.id) await changeDeliveryStatus(dispatcher, id, { status: "PICKED_UP" });
      await changeDeliveryStatus(dispatcher, id, { status: "IN_TRANSIT" });
      await changeDeliveryStatus(dispatcher, id, { status: "DELIVERED" });
    }
    expect((await getRouteById(route.id)).status).toBe("COMPLETED");
    // The crew is only freed after the last delivery on the route closes.
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe("AVAILABLE");
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("AVAILABLE");
  });

  it("returns deliveries to pending when a planned route is deleted", async () => {
    const a = await createDelivery(dispatcher, stop(12.91, 77.61, "Stop C"));
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    const route = await createRoute(dispatcher, { start, deliveryIds: [a.id], strategy: "optimized", name: "Short run", driverId: driver.id, vehicleId: vehicle.id });
    expect(route.deliveries[0].status).toBe("ASSIGNED");
    await deleteRoute(dispatcher, route.id);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: a.id } });
    expect(delivery).toMatchObject({ status: "PENDING", driverId: null, routeId: null });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("AVAILABLE");
  });
});

describe("GPS simulator", () => {
  it("moves an in-transit vehicle along its route, then completes the delivery and frees the crew", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    const simulator = new GpsSimulator(2000);
    const position = async () => {
      const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
      return [v.lastLat!, v.lastLng!] as const;
    };

    // Nothing moves until the delivery is in transit.
    const parked = await position();
    await simulator.tick(2000);
    expect(await position()).toEqual(parked);

    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });

    // One 2 s tick at 10x and 40 km/h covers ~0.22 km: a small step, not a teleport.
    expect(await simulator.tick(2000)).toBeGreaterThanOrEqual(1);
    const first = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(first.progress).toBeGreaterThan(0);
    expect(first.progress).toBeLessThan(0.05);
    const p1 = await position();
    await simulator.tick(2000);
    const second = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(second.progress).toBeGreaterThan(first.progress);
    expect(await position()).not.toEqual(p1);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).lastLocationAt).not.toBeNull();

    // The live map sees the vehicle with its active delivery.
    const onMap = (await fleetSnapshot()).find((v) => v.id === vehicle.id)!;
    expect(onMap.delivery).toMatchObject({ id: d.id, moving: true });
    expect(onMap.lat).toBeCloseTo((await position())[0], 6);

    // A long simulated interval reaches the destination.
    await simulator.tick(4 * 3600 * 1000);
    const done = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(done.status).toBe("DELIVERED");
    expect(done.progress).toBe(1);
    const end = await position();
    expect(end[0]).toBeCloseTo(done.destLat, 4);
    expect(end[1]).toBeCloseTo(done.destLng, 4);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("AVAILABLE");
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe("AVAILABLE");
    const lastEvent = await prisma.deliveryEvent.findFirst({ where: { deliveryId: d.id }, orderBy: { createdAt: "desc" } });
    expect(lastEvent?.note).toMatch(/simulated GPS/);

    // Once delivered, further ticks leave the vehicle where it is.
    await simulator.tick(2000);
    expect(await position()).toEqual(end);
  });

  it("can be paused and resumed", () => {
    const simulator = new GpsSimulator(60_000);
    expect(simulator.state().running).toBe(false);
    expect(simulator.start().running).toBe(true);
    expect(simulator.pause().running).toBe(false);
    expect(simulator.start().running).toBe(true);
    simulator.pause();
  });

  it("respects the auto-complete setting", async () => {
    const settings = await getSettings();
    await updateSettings(admin, { ...settings, simulationAutoComplete: false });
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput());
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    await new GpsSimulator().tick(4 * 3600 * 1000);
    const arrived = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(arrived.progress).toBe(1);
    expect(arrived.status).toBe("IN_TRANSIT"); // waits for a person to confirm
    await updateSettings(admin, { ...settings, simulationAutoComplete: true });
  });
});

describe("analytics, performance and reports", () => {
  it("derives dashboard and analytics figures from database records", async () => {
    const dashboard = await getDashboard(admin, range);
    const [vehicles, drivers, delivered, fuel] = await Promise.all([
      prisma.vehicle.count({ where: { deletedAt: null } }),
      prisma.driver.count({ where: { deletedAt: null } }),
      prisma.delivery.count({ where: { status: "DELIVERED", closedAt: { gte: range.from, lte: range.to } } }),
      prisma.fuelRecord.aggregate({ where: { date: { gte: range.from, lte: range.to } }, _sum: { totalCostPaise: true } }),
    ]);
    expect(dashboard.kpis.totalVehicles).toBe(vehicles);
    expect(dashboard.kpis.totalDrivers).toBe(drivers);
    expect(dashboard.kpis.completedDeliveries).toBe(delivered);
    expect(dashboard.kpis.fuelCostPaise).toBe(fuel._sum.totalCostPaise ?? 0);
    expect(dashboard.charts.vehicleStatus.reduce((s, x) => s + x.count, 0)).toBe(vehicles);
    expect(dashboard.charts.deliveryPerformance.reduce((s, x) => s + x.onTime + x.late, 0)).toBe(delivered);

    const analytics = await getAnalytics(range);
    const total = await prisma.delivery.count({ where: { scheduledAt: { gte: range.from, lte: range.to } } });
    expect(analytics.summary.totalDeliveries).toBe(total);
    expect(analytics.statusDistribution.reduce((s, x) => s + x.count, 0)).toBe(total);
    expect(analytics.timeline.reduce((s, x) => s + x.total, 0)).toBe(total);
    if (analytics.summary.delivered > 0) {
      expect(analytics.summary.costPerDeliveryPaise).toBe(Math.round((analytics.summary.fuelCostPaise + analytics.summary.maintenanceCostPaise) / analytics.summary.delivered));
    }
  });

  it("hides figures a role may not see", async () => {
    const dashboard = await getDashboard(dispatcher, range);
    expect(dashboard.kpis.fuelCostPaise).toBeNull();
    expect(dashboard.kpis.maintenanceCostPaise).toBeNull();
    expect(dashboard.recentActivity).toBeNull();
    expect(dashboard.maintenanceAlerts).toBeNull();
  });

  it("ranks drivers and limits drivers to their own performance", async () => {
    const driver = await createDriver(manager, driverInput({ loginPassword: "Driver@123" }));
    const vehicle = await createVehicle(manager, vehicleInput());
    for (let i = 0; i < 3; i++) {
      const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
      await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
      await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
      await changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED" });
    }
    const board = await leaderboard(range.from, range.to);
    const row = board.rows.find((r) => r.driver.id === driver.id)!;
    expect(row.stats).toMatchObject({ delivered: 3, failed: 0, onTime: 3, successRate: 1, onTimeRate: 1 });
    expect(row.stats.score).toBeCloseTo(100 * (0.45 + 0.4 + 0.15 * (3 / 15)), 1);
    expect(row.rank).not.toBeNull();
    const ranks = board.rows.filter((r) => r.rank != null).map((r) => r.stats.score!);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);

    const self: SessionUser = { id: driver.userId!, name: driver.fullName, email: driver.email, phone: null, role: "DRIVER", driverId: driver.id };
    const own = await driverPerformance(self, driver.id, range.from, range.to);
    expect(own.stats.delivered).toBe(3);
    expect(own.monthly.reduce((s, m) => s + m.delivered, 0)).toBe(3);
    const someoneElse = board.rows.find((r) => r.driver.id !== driver.id)!;
    await expect(driverPerformance(self, someoneElse.driver.id, range.from, range.to)).rejects.toMatchObject({ status: 403 });
    await expect(driverPerformance(manager, someoneElse.driver.id, range.from, range.to)).resolves.toBeTruthy();
  });

  it("builds every report as valid CSV with matching row counts", async () => {
    const expected: Record<string, number> = {
      deliveries: await prisma.delivery.count({ where: { scheduledAt: { gte: range.from, lte: range.to } } }),
      fuel: await prisma.fuelRecord.count({ where: { date: { gte: range.from, lte: range.to } } }),
      maintenance: await prisma.maintenanceRecord.count({ where: { serviceDate: { gte: range.from, lte: range.to } } }),
      vehicles: await prisma.vehicle.count({ where: { deletedAt: null } }),
      drivers: await prisma.driver.count({ where: { deletedAt: null } }),
    };
    for (const type of ["deliveries", "vehicles", "drivers", "fuel", "fuel-efficiency", "maintenance", "activity"]) {
      const report = await buildReport(type, range);
      expect(report.filename).toMatch(new RegExp(`^logitrack-${type}-\\d{4}-\\d{2}-\\d{2}_to_\\d{4}-\\d{2}-\\d{2}\\.csv$`));
      expect(report.headers.length).toBeGreaterThan(3);
      for (const row of report.rows) expect(row).toHaveLength(report.headers.length);
      if (type in expected) expect(report.rows).toHaveLength(expected[type]);

      const csv = toCsv(report.headers, report.rows);
      const lines = csv.slice(1).trimEnd().split("\r\n");
      expect(lines[0]).toBe(report.headers.join(","));
      expect(lines.length).toBeGreaterThanOrEqual(report.rows.length + 1);
    }
    await expect(buildReport("secrets", range)).rejects.toMatchObject({ status: 400 });
  });

  it("stores and returns system settings", async () => {
    const before = await getSettings();
    const updated = await updateSettings(admin, { ...before, companyName: "Test Logistics", simulationSpeed: 25, maintenanceReminderDays: 14 });
    expect(updated).toMatchObject({ companyName: "Test Logistics", simulationSpeed: 25, maintenanceReminderDays: 14 });
    expect(await prisma.activityLog.count({ where: { entityType: "Setting", userId: admin.id } })).toBeGreaterThan(0);
    await updateSettings(admin, before);
  });
});
