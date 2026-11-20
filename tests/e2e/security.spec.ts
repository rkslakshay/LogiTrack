import { expect, test, type APIRequestContext } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { ACCOUNTS, type RoleKey } from "./helpers";

// Security boundaries exercised over real HTTP and real websockets.
// (Service-level regressions live in tests/integration/security.test.ts.)

const BASE = `http://localhost:${process.env.E2E_PORT || 3100}`;

async function login(request: APIRequestContext, role: RoleKey) {
  const res = await request.post("/api/auth/login", { data: { email: ACCOUNTS[role].email, password: ACCOUNTS[role].password } });
  expect(res.status()).toBe(200);
  const cookie = (await request.storageState()).cookies.find((c) => c.name === "lt_session")!;
  return { cookie: `lt_session=${cookie.value}`, user: (await res.json()).data.user as { id: string; driverId: string | null } };
}

function connect(cookie: string | null, origin?: string): Promise<{ socket: Socket; error: string | null }> {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: "/socket.io", transports: ["websocket"], reconnection: false, timeout: 8000,
      extraHeaders: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
    });
    socket.on("connect", () => resolve({ socket, error: null }));
    socket.on("connect_error", (err) => resolve({ socket, error: err.message }));
  });
}

test.describe("Realtime channel security", () => {
  test("refuses sockets without a valid session or from another origin", async ({ playwright }) => {
    const anonymous = await connect(null);
    expect(anonymous.error).toBe("unauthorized");
    const forged = await connect(`lt_session=${"a".repeat(64)}`);
    expect(forged.error).toBe("unauthorized");

    const request = await playwright.request.newContext({ baseURL: BASE });
    const { cookie } = await login(request, "dispatcher");
    // A valid session presented from a page on another site is still refused.
    const crossSite = await connect(cookie, "https://evil.example");
    expect(crossSite.error).not.toBeNull();
    const sameSite = await connect(cookie, BASE);
    expect(sameSite.error).toBeNull();
    sameSite.socket.close();
    await request.dispose();
  });

  test("sends fleet-wide positions to staff only; a driver receives nothing about other vehicles", async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext({ baseURL: BASE });
    const driverCtx = await playwright.request.newContext({ baseURL: BASE });
    const admin = await login(adminCtx, "admin");
    const driver = await login(driverCtx, "driver");

    const own = (await (await driverCtx.get("/api/deliveries?scope=active")).json()).data.items as { vehicleId: string }[];
    const ownVehicles = new Set(own.map((d) => d.vehicleId));
    expect(ownVehicles.size).toBeGreaterThan(0);

    const staff = await connect(admin.cookie);
    const mine = await connect(driver.cookie);
    expect(staff.error).toBeNull();
    expect(mine.error).toBeNull();
    const staffSeen = new Set<string>();
    const driverSeen = new Set<string>();
    const driverEvents: string[] = [];
    staff.socket.on("vehicle:location", (e: { vehicleId: string }) => staffSeen.add(e.vehicleId));
    mine.socket.on("vehicle:location", (e: { vehicleId: string }) => driverSeen.add(e.vehicleId));
    mine.socket.onAny((event: string) => driverEvents.push(event));

    try {
      expect((await adminCtx.post("/api/simulator", { data: { action: "start" } })).status()).toBe(200);
      await expect.poll(() => staffSeen.size, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
      await expect.poll(() => driverSeen.size, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      await adminCtx.post("/api/simulator", { data: { action: "pause" } });
    }

    // The driver saw their own vehicle and nothing else, and no staff-only feeds.
    for (const id of driverSeen) expect(ownVehicles.has(id), `driver received position of vehicle ${id}`).toBe(true);
    expect(staffSeen.size).toBeGreaterThan(driverSeen.size);
    expect(driverEvents).not.toContain("simulator:state");

    staff.socket.close();
    mine.socket.close();
    await adminCtx.dispose();
    await driverCtx.dispose();
  });

  test("drops an open socket as soon as its session ends", async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: BASE });
    const { cookie } = await login(request, "dispatcher");
    const { socket, error } = await connect(cookie);
    expect(error).toBeNull();
    const disconnected = new Promise<string>((resolve) => socket.on("disconnect", resolve));

    expect((await request.post("/api/auth/logout")).status()).toBe(200);
    const reason = await Promise.race([disconnected, new Promise<string>((r) => setTimeout(() => r("still connected"), 10_000))]);
    expect(reason).toBe("io server disconnect");
    // And the old cookie cannot open a new one.
    expect((await connect(cookie)).error).toBe("unauthorized");
    await request.dispose();
  });
});

test.describe("HTTP security boundaries", () => {
  test("sets defensive response headers and does not advertise the framework", async ({ request }) => {
    for (const path of ["/", "/login", "/api/auth/me"]) {
      const headers = (await request.get(path)).headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-powered-by"], path).toBeUndefined();
    }
  });

  test("never reveals whether an email address has an account", async ({ request }) => {
    const wrongPassword = await request.post("/api/auth/login", { data: { email: ACCOUNTS.manager.email, password: "definitely-wrong" } });
    const unknownEmail = await request.post("/api/auth/login", { data: { email: "nobody.at.all@logitrack.in", password: "definitely-wrong" } });
    expect(wrongPassword.status()).toBe(401);
    expect(unknownEmail.status()).toBe(401);
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json());
  });

  test("rejects role escalation, mass assignment and invalid records at the API", async ({ playwright }) => {
    const dispatcher = await playwright.request.newContext({ baseURL: BASE });
    const me = await login(dispatcher, "dispatcher");

    // A profile update cannot change role, email or account state.
    const profile = await dispatcher.put("/api/profile", { data: { name: "Rohan Verma", phone: "", role: "SUPER_ADMIN", isActive: true, email: "owner@evil.example" } });
    expect(profile.status()).toBe(200);
    const after = (await (await dispatcher.get("/api/auth/me")).json()).data;
    expect(after).toMatchObject({ id: me.user.id, role: "DISPATCHER", email: ACCOUNTS.dispatcher.email });
    expect((await dispatcher.get("/api/users")).status()).toBe(403);
    expect((await dispatcher.put(`/api/users/${me.user.id}`, { data: { name: "x", email: ACCOUNTS.dispatcher.email, role: "SUPER_ADMIN", isActive: true } })).status()).toBe(403);

    // Manipulated query parameters are clamped or ignored, never executed.
    const big = (await (await dispatcher.get("/api/deliveries?pageSize=999999&page=-5&sort=passwordHash&dir=sideways")).json()).data;
    expect(big.pageSize).toBe(200);
    expect(big.page).toBe(1);
    const injected = await dispatcher.get(`/api/deliveries?q=${encodeURIComponent("' OR 1=1 --")}&status=${encodeURIComponent("PENDING' OR '1'='1")}`);
    expect(injected.status()).toBe(200);
    expect((await injected.json()).data.total).toBe(0);
    expect((await dispatcher.get("/api/deliveries/..%2F..%2Fusers")).status()).toBe(404);

    // Invalid status transitions and writes outside the role are refused.
    const pending = (await (await dispatcher.get("/api/deliveries?status=PENDING&pageSize=1")).json()).data.items[0];
    for (const status of ["DELIVERED", "IN_TRANSIT", "PICKED_UP", "NOT_A_STATUS"]) {
      const res = await dispatcher.post(`/api/deliveries/${pending.id}/status`, { data: { status } });
      expect([409, 422], `PENDING -> ${status}`).toContain(res.status());
    }
    expect((await (await dispatcher.get(`/api/deliveries/${pending.id}`)).json()).data.status).toBe("PENDING");
    // An edit cannot smuggle in a status or an assignment.
    const edit = await dispatcher.put(`/api/deliveries/${pending.id}`, {
      data: { ...pending, notes: "edited", status: "DELIVERED", progress: 1, deliveredAt: new Date().toISOString(), driverId: "", vehicleId: "" },
    });
    expect(edit.status()).toBe(200);
    expect((await edit.json()).data).toMatchObject({ status: "PENDING", progress: 0, deliveredAt: null, notes: "edited" });

    const vehicles = (await (await dispatcher.get("/api/vehicles?pageSize=1")).json()).data.items;
    expect((await dispatcher.put(`/api/vehicles/${vehicles[0].id}`, { data: { ...vehicles[0], status: "INACTIVE" } })).status()).toBe(403);
    expect((await dispatcher.put(`/api/vehicles/${vehicles[0].id}/driver`, { data: { driverId: null } })).status()).toBe(403);

    // Invalid financial records are rejected with field-level errors.
    const manager = await playwright.request.newContext({ baseURL: BASE });
    await login(manager, "manager");
    const fuel = { vehicleId: vehicles[0].id, date: new Date().toISOString().slice(0, 10), quantityL: 20, pricePerLitre: 95, odometer: 999_999, station: "Test", notes: "" };
    for (const [field, value] of [["pricePerLitre", -1], ["pricePerLitre", "1e999"], ["quantityL", 0], ["quantityL", -20], ["odometer", -1]] as const) {
      const res = await manager.post("/api/fuel", { data: { ...fuel, [field]: value } });
      expect(res.status(), `${field}=${value}`).toBe(422);
      expect((await res.json()).error.fieldErrors).toHaveProperty(field);
    }
    const badCost = await manager.post("/api/maintenance", { data: { vehicleId: vehicles[0].id, type: "BRAKE", description: "x", serviceDate: fuel.date, provider: "G", cost: -500 } });
    expect(badCost.status()).toBe(422);

    await dispatcher.dispose();
    await manager.dispose();
  });
});
