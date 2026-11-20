import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import type { ListQuery } from "@/lib/list";
import { createDriver, deleteDriver, getDriver, listDrivers, updateDriver } from "@/server/services/drivers";
import { createVehicle, deleteVehicle, getVehicle, listVehicles, updateVehicle } from "@/server/services/vehicles";
import { driverInput, makeUser, prisma, resetDb, vehicleInput } from "../helpers";

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({ page: 1, pageSize: 10, skip: 0, q: "", sort: null, dir: "desc", from: null, to: null, ...overrides });

let manager: SessionUser;
beforeAll(async () => {
  await resetDb();
  manager = await makeUser("FLEET_MANAGER");
});

describe("vehicle CRUD", () => {
  it("creates a vehicle with a generated code and an audit entry", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ registrationNumber: "MH 14 CD 0001", name: "Alpha Van" }));
    expect(vehicle.code).toMatch(/^VEH-\d{4}$/);
    expect(vehicle.status).toBe("AVAILABLE");
    const log = await prisma.activityLog.findFirst({ where: { entityType: "Vehicle", entityId: vehicle.id, action: "CREATE" } });
    expect(log?.userId).toBe(manager.id);
    expect(log?.description).toContain("MH 14 CD 0001");
  });

  it("generates sequential codes", async () => {
    const a = await createVehicle(manager, vehicleInput());
    const b = await createVehicle(manager, vehicleInput());
    expect(Number(b.code.slice(4))).toBe(Number(a.code.slice(4)) + 1);
  });

  it("rejects a duplicate registration number", async () => {
    await createVehicle(manager, vehicleInput({ registrationNumber: "KA 01 ZZ 9999" }));
    await expect(createVehicle(manager, vehicleInput({ registrationNumber: "KA 01 ZZ 9999" }))).rejects.toMatchObject({ code: "P2002" });
  });

  it("reads a vehicle with its history and statistics", async () => {
    const vehicle = await createVehicle(manager, vehicleInput());
    const detail = await getVehicle(vehicle.id);
    expect(detail.stats.totalDeliveries).toBe(0);
    expect(detail.history.length).toBeGreaterThan(0);
    await expect(getVehicle("does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("updates a vehicle and records status changes", async () => {
    const input = vehicleInput();
    const vehicle = await createVehicle(manager, input);
    const updated = await updateVehicle(manager, vehicle.id, { ...input, name: "Renamed", odometer: 12_500, status: "INACTIVE" });
    expect(updated).toMatchObject({ name: "Renamed", odometer: 12_500, status: "INACTIVE" });
    expect(await prisma.activityLog.count({ where: { entityId: vehicle.id, action: "STATUS_CHANGE" } })).toBe(1);
    // A status change notifies fleet managers.
    expect(await prisma.notification.count({ where: { userId: manager.id, category: "VEHICLE", entityId: vehicle.id } })).toBe(1);
  });

  it("searches, filters, sorts and paginates", async () => {
    await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 QQ 1111", name: "Searchable Truck", type: "TRUCK", odometer: 500 }));
    await createVehicle(manager, vehicleInput({ registrationNumber: "TN 09 QQ 2222", name: "Searchable Bike", type: "BIKE", odometer: 90_000 }));

    expect((await listVehicles(query({ q: "Searchable" }), {})).total).toBe(2);
    expect((await listVehicles(query({ q: "TN 09 QQ 1111" }), {})).items[0].name).toBe("Searchable Truck");
    expect((await listVehicles(query({ q: "Searchable" }), { type: "BIKE" })).items.map((v) => v.name)).toEqual(["Searchable Bike"]);
    expect((await listVehicles(query(), { status: "INACTIVE" })).items.every((v) => v.status === "INACTIVE")).toBe(true);

    const asc = await listVehicles(query({ q: "Searchable", sort: "odometer", dir: "asc" }), {});
    expect(asc.items.map((v) => v.odometer)).toEqual([500, 90_000]);
    const desc = await listVehicles(query({ q: "Searchable", sort: "odometer", dir: "desc" }), {});
    expect(desc.items.map((v) => v.odometer)).toEqual([90_000, 500]);

    const page1 = await listVehicles(query({ pageSize: 2 }), {});
    const page2 = await listVehicles(query({ pageSize: 2, page: 2, skip: 2 }), {});
    expect(page1.items).toHaveLength(2);
    expect(page1.pageCount).toBe(Math.ceil(page1.total / 2));
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it("ignores sort columns that are not whitelisted", async () => {
    const result = await listVehicles(query({ sort: "passwordHash" }), {});
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("soft-deletes so history survives, and hides the vehicle from lists", async () => {
    const vehicle = await createVehicle(manager, vehicleInput({ name: "To Be Removed" }));
    await deleteVehicle(manager, vehicle.id);
    const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe("INACTIVE");
    expect((await listVehicles(query({ q: "To Be Removed" }), {})).total).toBe(0);
    await expect(getVehicle(vehicle.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("driver CRUD", () => {
  it("creates a driver, optionally with a login account", async () => {
    const plain = await createDriver(manager, driverInput());
    expect(plain.code).toMatch(/^DRV-\d{4}$/);
    expect(plain.userId).toBeNull();

    const withLogin = await createDriver(manager, driverInput({ email: "login.driver@test.in", loginPassword: "Driver@123" }));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: withLogin.userId! } });
    expect(user).toMatchObject({ role: "DRIVER", email: "login.driver@test.in", isActive: true });
    expect(user.passwordHash).not.toContain("Driver@123");
  });

  it("rejects duplicate licence numbers", async () => {
    await createDriver(manager, driverInput({ licenseNumber: "MH12 2020 7777777" }));
    await expect(createDriver(manager, driverInput({ licenseNumber: "MH12 2020 7777777" }))).rejects.toMatchObject({ code: "P2002" });
  });

  it("updates a driver and keeps the login account in sync", async () => {
    const input = driverInput({ email: "sync@test.in", loginPassword: "Driver@123" });
    const driver = await createDriver(manager, input);
    await updateDriver(manager, driver.id, { ...input, fullName: "New Name", loginPassword: undefined, status: "INACTIVE" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.userId! } });
    expect(user.name).toBe("New Name");
    expect(user.isActive).toBe(false); // inactive drivers cannot sign in
  });

  it("filters and searches drivers and derives statistics from deliveries", async () => {
    await createDriver(manager, driverInput({ fullName: "Findable Person", status: "OFF_DUTY" }));
    const found = await listDrivers(query({ q: "Findable" }), {});
    expect(found.total).toBe(1);
    expect(found.items[0].stats).toMatchObject({ total: 0, delivered: 0, score: null });
    expect((await listDrivers(query(), { status: "OFF_DUTY" })).items.every((d) => d.status === "OFF_DUTY")).toBe(true);
  });

  it("deactivates a driver, releases the vehicle and disables the login", async () => {
    const driver = await createDriver(manager, driverInput({ email: "leaver@test.in", loginPassword: "Driver@123" }));
    const vehicle = await createVehicle(manager, vehicleInput({ assignedDriverId: driver.id }));
    await deleteDriver(manager, driver.id);

    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe("INACTIVE");
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).assignedDriverId).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: driver.userId! } })).isActive).toBe(false);
    await expect(getDriver(driver.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("vehicle-driver assignment", () => {
  it("assigns a driver when creating a vehicle and shows it from both sides", async () => {
    const driver = await createDriver(manager, driverInput());
    const vehicle = await createVehicle(manager, vehicleInput({ assignedDriverId: driver.id }));
    expect(vehicle.assignedDriver?.id).toBe(driver.id);
    expect((await getDriver(driver.id)).vehicle?.id).toBe(vehicle.id);
    expect(await prisma.activityLog.count({ where: { entityId: vehicle.id, action: "ASSIGN" } })).toBe(1);
  });

  it("moves a driver between vehicles instead of double-booking them", async () => {
    const driver = await createDriver(manager, driverInput());
    const inputA = vehicleInput({ assignedDriverId: driver.id });
    const a = await createVehicle(manager, inputA);
    const b = await createVehicle(manager, vehicleInput({ assignedDriverId: driver.id }));
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: a.id } })).assignedDriverId).toBeNull();
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: b.id } })).assignedDriverId).toBe(driver.id);
  });

  it("assigns and releases through the driver form", async () => {
    const input = driverInput();
    const driver = await createDriver(manager, input);
    const vehicle = await createVehicle(manager, vehicleInput());
    await updateDriver(manager, driver.id, { ...input, assignedVehicleId: vehicle.id });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).assignedDriverId).toBe(driver.id);
    await updateDriver(manager, driver.id, { ...input, assignedVehicleId: null });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).assignedDriverId).toBeNull();
  });

  it("refuses to assign an inactive driver", async () => {
    const driver = await createDriver(manager, driverInput({ status: "INACTIVE" }));
    await expect(createVehicle(manager, vehicleInput({ assignedDriverId: driver.id }))).rejects.toThrow(/inactive driver/);
  });
});
