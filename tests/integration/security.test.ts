import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearLoginFailures, createSession, destroySession, destroyUserSessions, getUserByToken, hashPassword, isSessionValid, loginThrottled, onSessionsRevoked,
  recordLoginFailure, verifyPasswordOrDummy, type SessionUser,
} from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fuelSchema, maintenanceCompleteSchema, maintenanceSchema, profileSchema, userCreateSchema, userUpdateSchema, vehicleSchema } from "@/lib/validation";
import { assignDelivery, changeDeliveryStatus, createDelivery, getDelivery, listDeliveries, reportIssue, updateDelivery } from "@/server/services/deliveries";
import { createDriver } from "@/server/services/drivers";
import { markRead } from "@/server/services/notifications";
import { driverPerformance } from "@/server/services/performance";
import { createRoute } from "@/server/services/routes";
import { deactivateUser, updateProfile, updateUser } from "@/server/services/users";
import { createVehicle } from "@/server/services/vehicles";
import { deliveryInput, driverInput, makeUser, prisma, resetDb, vehicleInput } from "../helpers";

// Regression tests for the security review (docs/SECURITY.md). Each test pins down
// one boundary: if it fails, a hole that was closed has reopened.

let admin: SessionUser;
let manager: SessionUser;
let dispatcher: SessionUser;

const crew = async (login = false) => ({
  driver: await createDriver(manager, driverInput(login ? { loginPassword: "Driver@123" } : {})),
  vehicle: await createVehicle(manager, vehicleInput()),
});
const asDriver = (d: { userId: string | null; id: string; fullName: string; email: string }): SessionUser => ({
  id: d.userId!, name: d.fullName, email: d.email, phone: null, role: "DRIVER", driverId: d.id,
});
const list = { page: 1, pageSize: 100, skip: 0, q: "", sort: null, dir: "desc" as const, from: null, to: null };

beforeAll(async () => {
  await resetDb();
  admin = await makeUser("SUPER_ADMIN");
  manager = await makeUser("FLEET_MANAGER");
  dispatcher = await makeUser("DISPATCHER");
});

describe("concurrent updates", () => {
  it("never double-books a driver when two assignments race", async () => {
    const { driver, vehicle } = await crew();
    const other = await createVehicle(manager, vehicleInput());
    const a = await createDelivery(dispatcher, deliveryInput());
    const b = await createDelivery(dispatcher, deliveryInput());

    const results = await Promise.allSettled([
      assignDelivery(dispatcher, a.id, { driverId: driver.id, vehicleId: vehicle.id }),
      assignDelivery(dispatcher, b.id, { driverId: driver.id, vehicleId: other.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });

    const active = await prisma.delivery.count({ where: { driverId: driver.id, status: "ASSIGNED" } });
    expect(active).toBe(1);
    // The loser's delivery is untouched and its vehicle was not left marked as busy.
    const loser = await prisma.delivery.findFirstOrThrow({ where: { id: { in: [a.id, b.id] }, status: "PENDING" } });
    expect(loser.driverId).toBeNull();
    const busyVehicles = await prisma.vehicle.count({ where: { id: { in: [vehicle.id, other.id] }, status: "ON_DELIVERY" } });
    expect(busyVehicles).toBe(1);
  });

  it("never double-books a vehicle when two assignments race", async () => {
    const a = await crew();
    const secondDriver = await createDriver(manager, driverInput());
    const d1 = await createDelivery(dispatcher, deliveryInput());
    const d2 = await createDelivery(dispatcher, deliveryInput());
    const results = await Promise.allSettled([
      assignDelivery(dispatcher, d1.id, { driverId: a.driver.id, vehicleId: a.vehicle.id }),
      assignDelivery(dispatcher, d2.id, { driverId: secondDriver.id, vehicleId: a.vehicle.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.delivery.count({ where: { vehicleId: a.vehicle.id, status: "ASSIGNED" } })).toBe(1);
    expect(await prisma.driver.count({ where: { id: { in: [a.driver.id, secondDriver.id] }, status: "ON_DELIVERY" } })).toBe(1);
  });

  it("assigns one delivery to one crew when two dispatchers assign it at once", async () => {
    const a = await crew();
    const b = await crew();
    const d = await createDelivery(dispatcher, deliveryInput());
    const results = await Promise.allSettled([
      assignDelivery(dispatcher, d.id, { driverId: a.driver.id, vehicleId: a.vehicle.id }),
      assignDelivery(dispatcher, d.id, { driverId: b.driver.id, vehicleId: b.vehicle.id }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const final = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([a.driver.id, b.driver.id]).toContain(final.driverId);
    // Exactly the winning crew is occupied; nobody is left "on delivery" with no delivery.
    const busyDrivers = await prisma.driver.findMany({ where: { id: { in: [a.driver.id, b.driver.id] }, status: "ON_DELIVERY" } });
    expect(busyDrivers.map((x) => x.id)).toEqual([final.driverId]);
    const busyVehicles = await prisma.vehicle.findMany({ where: { id: { in: [a.vehicle.id, b.vehicle.id] }, status: "ON_DELIVERY" } });
    expect(busyVehicles.map((x) => x.id)).toEqual([final.vehicleId]);
  });

  it("applies a status change once when the same update is sent twice at the same moment", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    const before = (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer;

    const results = await Promise.allSettled([
      changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED" }),
      changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // One completion event, and the trip distance added to the odometer exactly once.
    expect(await prisma.deliveryEvent.count({ where: { deliveryId: d.id, status: "DELIVERED" } })).toBe(1);
    const after = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(after.odometer).toBe(before + Math.round(d.distanceKm));
    expect(after.status).toBe("AVAILABLE");
  });

  it("does not let a completion and a failure both win", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    await changeDeliveryStatus(dispatcher, d.id, { status: "PICKED_UP" });
    await changeDeliveryStatus(dispatcher, d.id, { status: "IN_TRANSIT" });
    const results = await Promise.allSettled([
      changeDeliveryStatus(dispatcher, d.id, { status: "DELIVERED" }),
      changeDeliveryStatus(dispatcher, d.id, { status: "FAILED", note: "Refused" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const events = await prisma.deliveryEvent.findMany({ where: { deliveryId: d.id, status: { in: ["DELIVERED", "FAILED"] } } });
    expect(events).toHaveLength(1);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe(events[0].status);
  });

  it("keeps a route's crew consistent when the driver is taken first", async () => {
    const { driver, vehicle } = await crew();
    const busy = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    const a = await createDelivery(dispatcher, deliveryInput());
    const b = await createDelivery(dispatcher, deliveryInput());
    await expect(
      createRoute(dispatcher, { start: { label: "Depot", lat: 18.5, lng: 73.8 }, deliveryIds: [a.id, b.id], strategy: "optimized", name: "Blocked run", driverId: driver.id, vehicleId: vehicle.id }),
    ).rejects.toMatchObject({ status: 409 });
    // The whole route creation rolled back: no route, deliveries still pending and unrouted.
    expect(await prisma.route.count({ where: { name: "Blocked run" } })).toBe(0);
    const rows = await prisma.delivery.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.status === "PENDING" && r.routeId === null && r.driverId === null)).toBe(true);
    void busy;
  });
});

describe("cross-user data access (IDOR)", () => {
  it("gives a driver no path to another driver's delivery", async () => {
    const mine = await crew(true);
    const theirs = await crew(true);
    const me = asDriver(mine.driver);
    const own = await createDelivery(dispatcher, deliveryInput({ driverId: mine.driver.id, vehicleId: mine.vehicle.id }));
    const foreign = await createDelivery(dispatcher, deliveryInput({ driverId: theirs.driver.id, vehicleId: theirs.vehicle.id }));

    await expect(getDelivery(me, foreign.id)).rejects.toMatchObject({ status: 404 });
    await expect(changeDeliveryStatus(me, foreign.id, { status: "PICKED_UP" })).rejects.toMatchObject({ status: 404 });
    await expect(reportIssue(me, foreign.id, "probing")).rejects.toMatchObject({ status: 404 });
    // Manipulated filters cannot widen the scope.
    for (const filters of [{ driverId: theirs.driver.id }, { vehicleId: theirs.vehicle.id }, { scope: "active" }, { status: "ASSIGNED" }]) {
      const result = await listDeliveries(me, list, filters);
      expect(result.items.every((d) => d.driverId === mine.driver.id)).toBe(true);
    }
    expect((await listDeliveries(me, { ...list, q: foreign.code }, {})).total).toBe(0);
    expect((await listDeliveries(me, list, {})).items.map((d) => d.id)).toEqual([own.id]);
    // Nothing was changed by the attempts.
    const untouched = await prisma.delivery.findUniqueOrThrow({ where: { id: foreign.id }, include: { events: true } });
    expect(untouched.status).toBe("ASSIGNED");
    expect(untouched.events.some((e) => e.type === "ISSUE")).toBe(false);
  });

  it("does not let a driver read another driver's performance, or use writes they lack", async () => {
    const mine = await crew(true);
    const theirs = await crew(true);
    const me = asDriver(mine.driver);
    await expect(driverPerformance(me, theirs.driver.id, null, null)).rejects.toMatchObject({ status: 403 });
    await expect(driverPerformance(me, mine.driver.id, null, null)).resolves.toBeTruthy();
    for (const p of ["deliveries:write", "deliveries:status", "vehicles:read", "vehicles:write", "drivers:write", "tracking:view", "simulator:control", "users:manage", "demo:reset", "reports:export"] as const) {
      expect(can("DRIVER", p), p).toBe(false);
    }
  });

  it("scopes notifications to their owner", async () => {
    const a = await makeUser("DISPATCHER");
    const b = await makeUser("DISPATCHER");
    const note = await prisma.notification.create({ data: { userId: a.id, category: "SYSTEM", title: "Private", message: "x" } });
    await expect(markRead(b.id, note.id)).rejects.toMatchObject({ status: 404 });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).isRead).toBe(false);
  });

  it("treats a driver login without a driver profile as having no deliveries at all", async () => {
    const orphan = await makeUser("DRIVER");
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput({ driverId: driver.id, vehicleId: vehicle.id }));
    expect((await listDeliveries(orphan, list, {})).total).toBe(0);
    await expect(getDelivery(orphan, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(changeDeliveryStatus(orphan, d.id, { status: "PICKED_UP" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("role escalation and mass assignment", () => {
  it("strips fields a profile update must never change", async () => {
    const user = await makeUser("DISPATCHER");
    const parsed = profileSchema.parse({ name: "New Name", phone: "", role: "SUPER_ADMIN", isActive: true, email: "attacker@evil.example", passwordHash: "x", id: admin.id });
    expect(Object.keys(parsed).sort()).toEqual(["name", "phone"]);
    await updateProfile(user, parsed);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ name: "New Name", role: "DISPATCHER", email: user.email });
  });

  it("only accepts known roles", () => {
    const base = { name: "X Y", email: "x@test.in", phone: "", password: "Passw0rd!", isActive: true };
    expect(userCreateSchema.safeParse({ ...base, role: "ROOT" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, role: "SUPER_ADMIN" }).success).toBe(true);
    expect(userUpdateSchema.parse({ ...base, role: "DISPATCHER", passwordHash: "injected" })).not.toHaveProperty("passwordHash");
  });

  it("keeps the administrator invariants", async () => {
    const second = await makeUser("SUPER_ADMIN");
    await expect(updateUser(admin, admin.id, { name: admin.name, email: admin.email, phone: null, role: "DRIVER", isActive: true })).rejects.toThrow(/own role/);
    await deactivateUser(admin, second.id);
    await prisma.user.updateMany({ where: { role: "SUPER_ADMIN", id: { not: admin.id } }, data: { isActive: false } });
    // The last active super admin cannot be removed, even by another administrator-shaped actor.
    await expect(deactivateUser({ ...manager, role: "SUPER_ADMIN" }, admin.id)).rejects.toThrow(/last active Super Admin/);
  });

  it("does not let delivery edits smuggle in an assignment or a status", async () => {
    const { driver, vehicle } = await crew();
    const d = await createDelivery(dispatcher, deliveryInput());
    const updated = await updateDelivery(dispatcher, d.id, { ...deliveryInput({ customerName: "Edited" }), driverId: driver.id, vehicleId: vehicle.id, status: "DELIVERED" } as never);
    expect(updated).toMatchObject({ customerName: "Edited", status: "PENDING" });
    expect(updated.driver).toBeNull();
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe("AVAILABLE");
  });
});

describe("sessions and login", () => {
  it("takes the same code path for unknown accounts as for wrong passwords", async () => {
    const hash = await hashPassword("Correct@123");
    expect(await verifyPasswordOrDummy("Correct@123", hash)).toBe(true);
    expect(await verifyPasswordOrDummy("wrong", hash)).toBe(false);
    // No account: a real bcrypt comparison still runs, and the answer is always false.
    expect(await verifyPasswordOrDummy("anything", null)).toBe(false);
    expect(await verifyPasswordOrDummy("", undefined)).toBe(false);
  });

  it("throttles per account, independently of the client address", () => {
    const account = "account:victim@test.in";
    for (let i = 0; i < 19; i++) recordLoginFailure(account, 20);
    expect(loginThrottled(account)).toBe(false);
    recordLoginFailure(account, 20);
    expect(loginThrottled(account)).toBe(true);
    // A different spoofed address does not help: the account key is what is checked.
    expect(loginThrottled("victim@test.in|10.0.0.99")).toBe(false);
    clearLoginFailures(account);
    expect(loginThrottled(account)).toBe(false);
  });

  it("announces revocation so realtime connections can be dropped", async () => {
    const listener = vi.fn();
    onSessionsRevoked(listener);
    const user = await makeUser("DISPATCHER");
    const a = await createSession(user.id);
    const b = await createSession(user.id);
    expect(await isSessionValid(a.token)).toBe(true);

    await destroySession(a.token);
    expect(listener).toHaveBeenLastCalledWith(user.id);
    expect(await isSessionValid(a.token)).toBe(false);
    expect(await isSessionValid(b.token)).toBe(true);

    await destroyUserSessions(user.id);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await isSessionValid(b.token)).toBe(false);
    onSessionsRevoked(() => undefined);
  });

  it("invalidates sessions when an account is deactivated or its role changes", async () => {
    const target = await makeUser("DISPATCHER");
    const s1 = await createSession(target.id);
    await updateUser(admin, target.id, { name: target.name, email: target.email, phone: null, role: "FLEET_MANAGER", isActive: true });
    expect(await getUserByToken(s1.token)).toBeNull();

    const s2 = await createSession(target.id);
    await deactivateUser(admin, target.id);
    expect(await getUserByToken(s2.token)).toBeNull();
    // Even a session created while deactivated resolves to nobody.
    const s3 = await createSession(target.id);
    expect(await getUserByToken(s3.token)).toBeNull();
  });
});

describe("invalid financial and numeric input", () => {
  const fuel = { vehicleId: "v", date: new Date(), quantityL: 40, pricePerLitre: 92.5, odometer: 1000, station: "Pump", notes: "" };
  const maintenance = { vehicleId: "v", type: "BRAKE", description: "x", serviceDate: new Date(), provider: "G", cost: 100 };

  it("rejects negative, zero, non-numeric, infinite and absurd amounts", () => {
    for (const bad of [-1, 0, "abc", Number.NaN, Number.POSITIVE_INFINITY, "1e999", 501]) {
      expect(fuelSchema.safeParse({ ...fuel, pricePerLitre: bad }).success, `price ${bad}`).toBe(false);
    }
    for (const bad of [-5, 0, "ten", Number.NaN, Number.POSITIVE_INFINITY, 100_000]) {
      expect(fuelSchema.safeParse({ ...fuel, quantityL: bad }).success, `quantity ${bad}`).toBe(false);
    }
    for (const bad of [-1, "free", Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
      expect(maintenanceSchema.safeParse({ ...maintenance, cost: bad }).success, `cost ${bad}`).toBe(false);
      expect(maintenanceCompleteSchema.safeParse({ cost: bad }).success, `final cost ${bad}`).toBe(false);
    }
    expect(fuelSchema.safeParse({ ...fuel, odometer: -10 }).success).toBe(false);
    expect(fuelSchema.safeParse({ ...fuel, odometer: 10.5 }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...vehicleInput(), odometer: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("computes totals on the server from quantity and price, ignoring any client total", () => {
    const parsed = fuelSchema.parse({ ...fuel, totalCost: 1, totalCostPaise: 1 });
    expect(parsed).not.toHaveProperty("totalCost");
    expect(parsed).not.toHaveProperty("totalCostPaise");
  });
});
