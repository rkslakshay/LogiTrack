import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, loginViaApi, loginViaUi } from "./helpers";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const navLinks = async (page: Page) => (await nav(page).getByRole("link").allTextContents()).map((t) => t.trim());

test.describe("Workflow F: authentication and role-based access", () => {
  test("signed-out visitors are sent to the login page and the API answers 401", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

    for (const url of ["/api/vehicles", "/api/deliveries", "/api/dashboard", "/api/users", "/api/auth/me"]) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    }
  });

  test("the login form validates input and rejects wrong credentials without revealing which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();

    await page.getByLabel("Email").fill(ACCOUNTS.admin.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();

    await page.getByLabel("Email").fill("nobody@logitrack.in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the session cookie is HttpOnly and logging out ends the session", async ({ page, context }) => {
    await loginViaUi(page, "admin");
    const cookie = (await context.cookies()).find((c) => c.name === "lt_session");
    expect(cookie).toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("lt_session");

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await page.goto("/vehicles");
    await expect(page).toHaveURL(/\/login/);
  });

  test("cross-site requests cannot change data", async ({ page }) => {
    await loginViaApi(page, "admin");
    const res = await page.request.post("/api/notifications/read-all", { headers: { Origin: "https://evil.example" }, data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.message).toContain("Cross-origin");
  });

  test("Super Admin has full access", async ({ page }) => {
    await loginViaUi(page, "admin");
    const links = await navLinks(page);
    for (const label of ["Dashboard", "Vehicles", "Drivers", "Live Tracking", "Deliveries", "Route Planning", "Fuel Management", "Maintenance", "Notifications", "Analytics", "Driver Performance", "Reports", "Activity Logs", "User Management", "Settings"]) {
      expect(links, label).toContain(label);
    }
    expect(links).not.toContain("My Deliveries");

    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add user" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "admin@logitrack.in" })).toContainText("Super Admin");

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Activity Logs" })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: "System" })).toBeVisible();

    for (const url of ["/api/users", "/api/activity", "/api/analytics", "/api/fuel", "/api/maintenance", "/api/tracking"]) {
      expect((await page.request.get(url)).status(), url).toBe(200);
    }
    // Password hashes never leave the server.
    expect(await (await page.request.get("/api/users")).text()).not.toContain("passwordHash");
  });

  test("Fleet Manager manages the fleet but not users or settings", async ({ page }) => {
    await loginViaUi(page, "manager");
    const links = await navLinks(page);
    for (const label of ["Vehicles", "Drivers", "Fuel Management", "Maintenance", "Analytics", "Reports", "Activity Logs"]) expect(links, label).toContain(label);
    expect(links).not.toContain("User Management");

    await page.goto("/vehicles");
    await expect(page.getByRole("button", { name: "Add vehicle" })).toBeVisible();

    // Direct navigation to an admin page bounces back to the dashboard.
    await page.goto("/users");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "System" })).toHaveCount(0);

    expect((await page.request.get("/api/users")).status()).toBe(403);
    expect((await page.request.post("/api/users", { data: { name: "X", email: "x@test.in", role: "SUPER_ADMIN", password: "Passw0rd!" } })).status()).toBe(403);
    expect((await page.request.put("/api/settings", { data: { companyName: "Hacked" } })).status()).toBe(403);
    expect((await page.request.get("/api/fuel")).status()).toBe(200);
  });

  test("Dispatcher plans and dispatches but cannot change the fleet or see costs", async ({ page }) => {
    await loginViaUi(page, "dispatcher");
    const links = await navLinks(page);
    for (const label of ["Dashboard", "Vehicles", "Drivers", "Live Tracking", "Deliveries", "Route Planning", "Notifications"]) expect(links, label).toContain(label);
    for (const label of ["Fuel Management", "Maintenance", "Analytics", "Reports", "Activity Logs", "User Management"]) expect(links, label).not.toContain(label);

    // Fleet is read-only: no create button, no edit or delete in the row menu.
    await page.goto("/vehicles");
    await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
    await expect(page.getByRole("row")).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add vehicle" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "View details" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/deliveries");
    await expect(page.getByRole("button", { name: "Create delivery" })).toBeVisible();

    for (const path of ["/fuel", "/maintenance", "/analytics", "/reports", "/activity", "/users"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard$/);
    }

    // The same rules hold when calling the API directly.
    const vehicles = await (await page.request.get("/api/vehicles?pageSize=1")).json();
    const vehicleId = vehicles.data.items[0].id;
    expect((await page.request.post("/api/vehicles", { data: {} })).status()).toBe(403);
    expect((await page.request.delete(`/api/vehicles/${vehicleId}`)).status()).toBe(403);
    expect((await page.request.post("/api/drivers", { data: {} })).status()).toBe(403);
    for (const url of ["/api/fuel", "/api/maintenance", "/api/analytics", "/api/activity", "/api/users", "/api/reports/deliveries", "/api/performance"]) {
      expect((await page.request.get(url)).status(), url).toBe(403);
    }
    expect((await page.request.get("/api/deliveries")).status()).toBe(200);
    expect((await page.request.get("/api/tracking")).status()).toBe(200);

    // Cost figures are withheld from the dispatcher's dashboard.
    const dashboard = (await (await page.request.get("/api/dashboard")).json()).data;
    expect(dashboard.kpis.fuelCostPaise).toBeNull();
    expect(dashboard.recentActivity).toBeNull();
    await page.goto("/dashboard");
    await expect(page.getByText("Active deliveries").first()).toBeVisible();
    await expect(page.getByText("Fuel expenditure")).toHaveCount(0);
  });

  test("Driver sees only their own work", async ({ page }) => {
    await loginViaUi(page, "driver");
    await expect(page).toHaveURL(/\/my-deliveries$/);
    await expect(page.getByRole("heading", { name: "My Deliveries" })).toBeVisible();
    expect(await navLinks(page)).toEqual(["My Deliveries", "My Performance", "Notifications", "Settings"]);

    // Every staff page redirects back to the driver's home.
    for (const path of ["/dashboard", "/vehicles", "/drivers", "/deliveries", "/tracking", "/routes", "/fuel", "/analytics", "/users"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/my-deliveries$/);
    }

    for (const url of ["/api/vehicles", "/api/drivers", "/api/tracking", "/api/dashboard", "/api/fuel", "/api/users", "/api/performance", "/api/routes"]) {
      expect((await page.request.get(url)).status(), url).toBe(403);
    }
    expect((await page.request.post("/api/deliveries", { data: {} })).status()).toBe(403);
    expect((await page.request.post("/api/simulator", { data: { action: "pause" } })).status()).toBe(403);

    // The delivery list is scoped to the signed-in driver, whatever filter is sent.
    const me = (await (await page.request.get("/api/auth/me")).json()).data;
    const own = (await (await page.request.get("/api/deliveries?pageSize=100")).json()).data;
    expect(own.total).toBeGreaterThan(0);
    expect(own.items.every((d: { driverId: string }) => d.driverId === me.driverId)).toBe(true);
    const all = (await (await page.request.get("/api/deliveries?pageSize=100&driverId=someone-else")).json()).data;
    expect(all.total).toBe(0);

    // Another driver's delivery cannot be read or updated.
    const admin = await page.context().browser()!.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT || 3100}` });
    const adminLogin = await admin.request.post("/api/auth/login", { data: { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password } });
    expect(adminLogin.status()).toBe(200);
    const others = (await (await admin.request.get("/api/deliveries?scope=active&pageSize=100")).json()).data.items.filter((d: { driverId: string }) => d.driverId !== me.driverId);
    await admin.close();
    expect(others.length).toBeGreaterThan(0);
    expect((await page.request.get(`/api/deliveries/${others[0].id}`)).status()).toBe(404);
    expect((await page.request.post(`/api/deliveries/${others[0].id}/status`, { data: { status: "DELIVERED" } })).status()).toBe(404);

    // Own performance is available; other drivers' performance is not.
    await page.goto("/my-performance");
    await expect(page.getByRole("heading", { name: "My Performance" })).toBeVisible();
    await expect(page.getByText("How the performance score is calculated")).toBeVisible();
    expect((await page.request.get(`/api/performance/${others[0].driverId}`)).status()).toBe(403);
  });

  test("a driver can update their own delivery and report an issue", async ({ page }) => {
    await loginViaApi(page, "driver");
    await page.goto("/my-deliveries");
    await expect(page.getByRole("button", { name: "Report issue" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Report issue" }).first().click();
    const issue = page.getByRole("dialog");
    await issue.getByLabel("What is the problem?").fill("Long queue at the toll plaza");
    await issue.getByRole("button", { name: "Report issue" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Issue reported to dispatch" })).toBeVisible();

    // Drivers are never offered "Cancelled".
    await page.getByRole("button", { name: "Update status" }).first().click();
    const status = page.getByRole("dialog");
    const options = await status.getByLabel("New status").locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContain("Cancelled");
    expect(options).not.toContain("Assigned");
  });
});
