import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import type { ListQuery } from "@/lib/list";
import {
  assignDelivery, changeDeliveryStatus, createDelivery, deleteDelivery, flagOverdueDeliveries, getDelivery, listDeliveries, reportIssue, unassignDelivery,
  updateDelivery,
} from "@/server/services/deliveries";
import { createDriver, deleteDriver } from "@/server/services/drivers";
import { createVehicle, deleteVehicle, updateVehicle } from "@/server/services/vehicles";
import { deliveryInput, driverInput, makeUser, prisma, resetDb, vehicleInput } from "../helpers";

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({ page: 1, pageSize: 50, skip: 0, q: "", sort: null, dir: "desc", from: null, to: null, ...overrides });

let dispatcher: SessionUser;
let manager: SessionUser;

/** A fresh available driver + vehicle pair. */
async function crew(withLogin = false) {
  const driver = await createDriver(manager, driverInput(withLogin ? { loginPassword: "Driver@123" } : {}));
  const vehicleData = vehicleInput();
  const vehicle = await createVehicle(manager, vehicleData);
  return { driver, vehicle, vehicleData };
}
const statusOf = async (id: string) => (await prisma.delivery.findUniqueOrThrow({ where: { id } })).status;
const driverStatus = async (id: string) => (await prisma.driver.findUniqueOrThrow({ where: { id } })).status;
const vehicleStatus = async (id: string) => (await prisma.vehicle.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await resetDb();
  dispatcher = await makeUser("DISPATCHER");
  manager = await makeUser("FLEET_MANAGER");
});

describe("delivery creation", () => {
  it("creates a pending delivery with distance, estimate, route geometry and a first event", async () => {
    const d = await createDelivery(dispatcher, deliveryInput());
    expect(d.code).toMatch(/^DEL-\d{4}$/);
    expect(d.status).toBe("PENDING");
    expect(d.distanceKm).toBeGreaterThan(15); // Hinjewadi -> Hadapsar is ~21 km straight, more by road
    expect(d.distanceKm).toBeLessThan(40);
    expect(d.estimatedMinutes).toBeGreaterThan(0);
    expect(d.geometry.length).toBeGreaterThan(2);
    expect(d.geometrySource).toBe("local");
    expect(d.events.map((e) => e.type)).toEqual(["CREATED"]);
    expect(d.createdBy?.id).toBe(dispatcher.id);
  });

  it("can assign a driver and vehicle at creation", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    expect(d.status).toBe("ASSIGNED");
    expect(d.events.map((e) => e.type)).toEqual(["CREATED", "ASSIGNMENT"]);
  });

  it("filters by status, priority, date and search text", async () => {
    await createDelivery(dispatcher, deliveryInput({ customerName: "Unique Customer Pvt Ltd", priority: "URGENT" }));
    expect((await listDeliveries(dispatcher, query({ q: "Unique Customer" }), {})).total).toBe(1);
    expect((await listDeliveries(dispatcher, query(), { priority: "URGENT" })).items.every((d) => d.priority === "URGENT")).toBe(true);
    expect((await listDeliveries(dispatcher, query(), { status: "PENDING" })).items.every((d) => d.status === "PENDING")).toBe(true);
    const future = new Date(Date.now() + 30 * 86_400_000);
    expect((await listDeliveries(dispatcher, query({ from: future }), {})).total).toBe(0);
    // Lists never ship the bulky geometry column.
    expect((await listDeliveries(dispatcher, query(), {})).items[0]).not.toHaveProperty("routeGeometry");
  });
});

describe("delivery assignment", () => {
  it("assigns and marks the driver and vehicle as on delivery", async () => {
    const { driver, vehicle } = await crew(true);
    const created = await createDelivery(dispatcher, deliveryInput());
    const d = await assignDelivery(dispatcher, created.id, { driverId: driver.id, vehicleId: vehicle.id });

    expect(d.status).toBe("ASSIGNED");
    expect(d.driver?.id).toBe(driver.id);
    expect(await driverStatus(driver.id)).toBe("ON_DELIVERY");
    expect(await vehicleStatus(vehicle.id)).toBe("ON_DELIVERY");
    expect(d.events.at(-1)).toMatchObject({ type: "ASSIGNMENT", status: "ASSIGNED" });
    // The driver is told about the new job.
    const note = await prisma.notification.findFirst({ where: { userId: driver.userId!, entityId: created.id } });
    expect(note?.title).toBe("New delivery assigned");
  });

  it("prevents assigning a driver who is already on a delivery", async () => {
    const { driver, vehicle } = await crew();
    const other = await crew();
    const first = await createDelivery(dispatcher, deliveryInput());
    await assignDelivery(dispatcher, first.id, { driverId: driver.id, vehicleId: vehicle.id });

    const second = await createDelivery(dispatcher, deliveryInput());
    await expect(assignDelivery(dispatcher, second.id, { driverId: driver.id, vehicleId: other.vehicle.id })).rejects.toMatchObject({
      status: 409, fieldErrors: { driverId: expect.stringContaining("on delivery") },
    });
    expect(await statusOf(second.id)).toBe("PENDING");
  });

  it("prevents assigning a vehicle that is on delivery, under maintenance or inactive", async () => {
    const busy = await crew();
    const first = await createDelivery(dispatcher, deliveryInput());
    await assignDelivery(dispatcher, first.id, { driverId: busy.driver.id, vehicleId: busy.vehicle.id });

    const free = await crew();
    const d = await createDelivery(dispatcher, deliveryInput());
    await expect(assignDelivery(dispatcher, d.id, { driverId: free.driver.id, vehicleId: busy.vehicle.id })).rejects.toMatchObject({ status: 409 });

    await updateVehicle(manager, free.vehicle.id, { ...free.vehicleData, status: "MAINTENANCE" });
    await expect(assignDelivery(dispatcher, d.id, { driverId: free.driver.id, vehicleId: free.vehicle.id })).rejects.toThrow(/maintenance/);
    await updateVehicle(manager, free.vehicle.id, { ...free.vehicleData, status: "INACTIVE" });
    await expect(assignDelivery(dispatcher, d.id, { driverId: free.driver.id, vehicleId: free.vehicle.id })).rejects.toThrow(/inactive/);
  });

  it("prevents assigning off-duty drivers and drivers with an expired licence", async () => {
    const offDuty = await createDriver(manager, driverInput({ status: "OFF_DUTY" }));
    const expired = await createDriver(manager, driverInput({ licenseExpiry: new Date(Date.now() - 86_400_000) }));
    const vehicle = await createVehicle(manager, vehicleInput());
    const d = await createDelivery(dispatcher, deliveryInput());
    await expect(assignDelivery(dispatcher, d.id, { driverId: offDuty.id, vehicleId: vehicle.id })).rejects.toThrow(/off duty/);
    await expect(assignDelivery(dispatcher, d.id, { driverId: expired.id, vehicleId: vehicle.id })).rejects.toThrow(/licence has expired/);
  });

  it("releases the previous crew on reassignment", async () => {
    const a = await crew();
    const b = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: a.driver.id, vehicleId: a.vehicle.id }));
    await assignDelivery(dispatcher, d.id, { driverId: b.driver.id, vehicleId: b.vehicle.id });
    expect(await driverStatus(a.driver.id)).toBe("AVAILABLE");
    expect(await vehicleStatus(a.vehicle.id)).toBe("AVAILABLE");
    expect(await driverStatus(b.driver.id)).toBe("ON_DELIVERY");
    expect(await vehicleStatus(b.vehicle.id)).toBe("ON_DELIVERY");
  });

  it("unassigns back to pending and frees the crew", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    const after = await unassignDelivery(dispatcher, d.id);
    expect(after.status).toBe("PENDING");
    expect(after.driver).toBeNull();
    expect(await driverStatus(driver.id)).toBe("AVAILABLE");
    expect(await vehicleStatus(vehicle.id)).toBe("AVAILABLE");
  });

  it("blocks deleting a vehicle or driver that has an active delivery", async () => {
    const { driver, vehicle } = await crew();
    await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await expect(deleteVehicle(manager, vehicle.id)).rejects.toThrow(/active delivery/);
    await expect(deleteDriver(manager, driver.id)).rejects.toThrow(/active delivery/);
  });
});

describe("delivery status transitions", () => {
  it("runs the full workflow and records every step", async () => {
    const { driver, vehicle } = await crew();
    const odometerBefore = (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer;
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));

    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED", note: "Signed by store manager" });

    const done = await getDelivery(dispatcher, d.id);
    expect(done.status).toBe("DELIVERED");
    expect(done.pickedUpAt).not.toBeNull();
    expect(done.deliveredAt).not.toBeNull();
    expect(done.closedAt).not.toBeNull();
    expect(done.progress).toBe(1);
    expect(done.nextStatuses).toEqual([]);
    expect(done.events.map((e) => e.status)).toEqual(["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"]);
    expect(done.events.at(-1)?.note).toBe("Signed by store manager");
    expect(done.events.at(-1)?.user?.id).toBe(dispatcher.id);

    // Completion frees the crew, adds the trip to the odometer and parks the vehicle at the destination.
    expect(await driverStatus(driver.id)).toBe("AVAILABLE");
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.status).toBe("AVAILABLE");
    expect(v.odometer).toBe(odometerBefore + Math.round(done.distanceKm));
    expect(v.lastLat).toBeCloseTo(done.destLat, 5);

    expect(await prisma.activityLog.count({ where: { entityType: "Delivery", entityId: d.id, action: "STATUS_CHANGE" } })).toBe(3);
    expect(await prisma.notification.count({ where: { userId: dispatcher.id, entityId: d.id, title: "Delivery completed" } })).toBe(1);
  });

  it("rejects invalid transitions with a clear message", async () => {
    const { driver, vehicle } = await crew();
    const pending = await createDelivery(dispatcher, deliveryInput());
    await expect(changeDeliveryStatus(dispatcher, pending.id, { status: "DELIVERED" })).rejects.toMatchObject({ status: 409 });
    await expect(changeDeliveryStatus(dispatcher, pending.id, { status: "IN_TRANSIT" })).rejects.toThrow(/cannot be changed/);
    await expect(changeDeliveryStatus(dispatcher, pending.id, { status: "ASSIGNED" })).rejects.toThrow(/assign action/);

    const assigned = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await expect(changeDeliveryStatus(dispatcher, assigned.id, { status: "DELIVERED" })).rejects.toMatchObject({ status: 409 });
    await expect(changeDeliveryStatus(dispatcher, assigned.id, { status: "ASSIGNED" })).rejects.toThrow();
    await expect(changeDeliveryStatus(dispatcher, "missing", { status: "PICKED_UP" })).rejects.toMatchObject({ status: 404 });
  });

  it("does not allow changes once a delivery is closed", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "CANCELLED", note: "Customer cancelled" });
    await expect(changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" })).rejects.toMatchObject({ status: 409 });
    await expect(assignDelivery(dispatcher, d.id, { driverId: driver.id, vehicleId: vehicle.id })).rejects.toThrow(/no longer be reassigned/);
    await expect(updateDelivery(dispatcher, d.id, deliveryInput())).rejects.toThrow(/no longer be edited/);
  });

  it("requires a reason for delays, failures and cancellations", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await expect(changeDeliveryStatus(dispatcher, d.id, { status: "DELAYED" })).rejects.toMatchObject({ status: 400, fieldErrors: { note: expect.any(String) } });
    await changeDeliveryStatus(dispatcher, d.id, { status: "DELAYED", note: "Road closed" });
    expect(await statusOf(d.id)).toBe("DELAYED");
    // Driver and vehicle stay occupied while delayed.
    expect(await driverStatus(driver.id)).toBe("ON_DELIVERY");
    expect(await prisma.notification.count({ where: { userId: dispatcher.id, entityId: d.id, title: "Delivery delayed" } })).toBe(1);
  });

  it("resumes a delayed delivery and can still complete it", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "DELAYED", note: "Traffic" });
    expect((await getDelivery(dispatcher, d.id)).nextStatuses).toEqual(["IN_TRANSIT", "DELIVERED", "FAILED"]);
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED" });
    expect(await statusOf(d.id)).toBe("DELIVERED");
  });

  it("releases the crew when a delivery fails or is cancelled", async () => {
    for (const status of ["FAILED", "CANCELLED"] as const) {
      const { driver, vehicle } = await crew();
      const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
      await changeDeliveryStatus(dispatcher, d.id, { status, note: "Reason" });
      expect(await driverStatus(driver.id)).toBe("AVAILABLE");
      expect(await vehicleStatus(vehicle.id)).toBe("AVAILABLE");
    }
  });

  it("flags overdue active deliveries as delayed automatically", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await prisma.delivery.update({ where: { id: d.id }, data: { expectedAt: new Date(Date.now() - 60_000) } });
    expect(await flagOverdueDeliveries()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(d.id)).toBe("DELAYED");
    const event = await prisma.deliveryEvent.findFirst({ where: { deliveryId: d.id, status: "DELAYED" } });
    expect(event?.userId).toBeNull(); // system event
    // Running it again does nothing.
    expect(await flagOverdueDeliveries()).toBe(0);
  });
});

describe("editing and deleting", () => {
  it("updates details and recalculates the route when locations change", async () => {
    const d = await createDelivery(dispatcher, deliveryInput());
    const moved = await updateDelivery(dispatcher, d.id, deliveryInput({ customerName: "Renamed Customer", destLat: 18.7606, destLng: 73.8636, destinationAddress: "Chakan, Pune" }));
    expect(moved.customerName).toBe("Renamed Customer");
    expect(moved.distanceKm).not.toBe(d.distanceKm);
    expect(moved.events.at(-1)?.type).toBe("UPDATED");
  });

  it("locks locations after pickup", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await expect(updateDelivery(dispatcher, d.id, deliveryInput({ destLat: 19.0 }))).rejects.toThrow(/picked up/);
  });

  it("only deletes pending or cancelled deliveries", async () => {
    const { driver, vehicle } = await crew();
    const active = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await expect(deleteDelivery(dispatcher, active.id)).rejects.toMatchObject({ status: 409 });

    const pending = await createDelivery(dispatcher, deliveryInput());
    await deleteDelivery(dispatcher, pending.id);
    expect(await prisma.delivery.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(await prisma.deliveryEvent.count({ where: { deliveryId: pending.id } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { entityId: pending.id, action: "DELETE" } })).toBe(1);
  });
});

describe("driver access control", () => {
  async function driverActor() {
    const { driver, vehicle } = await crew(true);
    const actor: SessionUser = { id: driver.userId!, name: driver.fullName, email: driver.email, phone: null, role: "DRIVER", driverId: driver.id };
    return { driver, vehicle, actor };
  }

  it("shows drivers only their own deliveries", async () => {
    const mine = await driverActor();
    const theirs = await driverActor();
    const a = await createDelivery(dispatcher, deliveryInput({ driverId: mine.driver.id, vehicleId: mine.vehicle.id }));
    const b = await createDelivery(dispatcher, deliveryInput({ driverId: theirs.driver.id, vehicleId: theirs.vehicle.id }));

    const list = await listDeliveries(mine.actor, query(), {});
    expect(list.items.map((d) => d.id)).toEqual([a.id]);
    // Asking for someone else's delivery by filter or by id reveals nothing.
    expect((await listDeliveries(mine.actor, query(), { driverId: theirs.driver.id })).total).toBe(0);
    await expect(getDelivery(mine.actor, b.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lets a driver progress their own delivery but not someone else's", async () => {
    const mine = await driverActor();
    const theirs = await driverActor();
    const a = await createDelivery(dispatcher, deliveryInput({ driverId: mine.driver.id, vehicleId: mine.vehicle.id }));
    const b = await createDelivery(dispatcher, deliveryInput({ driverId: theirs.driver.id, vehicleId: theirs.vehicle.id }));

    await changeDeliveryStatus(mine.actor, a.id, { status: "PICKED_UP" });
    expect(await statusOf(a.id)).toBe("PICKED_UP");
    await expect(changeDeliveryStatus(mine.actor, b.id, { status: "PICKED_UP" })).rejects.toMatchObject({ status: 404 });
    expect(await statusOf(b.id)).toBe("ASSIGNED");
  });

  it("does not let a driver cancel a delivery", async () => {
    const mine = await driverActor();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: mine.driver.id, vehicleId: mine.vehicle.id }));
    await expect(changeDeliveryStatus(mine.actor, d.id, { status: "CANCELLED", note: "No" })).rejects.toMatchObject({ status: 403 });
    expect((await getDelivery(mine.actor, d.id)).nextStatuses).not.toContain("CANCELLED");
    expect((await getDelivery(mine.actor, d.id)).canAssign).toBe(false);
  });

  it("lets a driver report an issue, which notifies dispatch without changing the status", async () => {
    const mine = await driverActor();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: mine.driver.id, vehicleId: mine.vehicle.id }));
    const after = await reportIssue(mine.actor, d.id, "Consignee is not answering");
    expect(after.status).toBe("ASSIGNED");
    expect(after.events.at(-1)).toMatchObject({ type: "ISSUE", note: "Consignee is not answering" });
    expect(await prisma.notification.count({ where: { userId: dispatcher.id, entityId: d.id, title: "Delivery issue reported" } })).toBe(1);
  });

  it("gives a user without a driver profile nothing", async () => {
    const orphan = await makeUser("DRIVER");
    expect((await listDeliveries(orphan, query(), {})).total).toBe(0);
  });
});
