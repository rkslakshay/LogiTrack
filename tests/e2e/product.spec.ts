import { expect, test, type Page } from "@playwright/test";
import { apiGet, apiSend, loginViaApi, toast, uniqueRegistration } from "./helpers";

// LogiTrack 2.0: the public landing page, the demo experience and the intelligence features.
// This file runs first and ends with a demo reset, so the later specs start from clean sample data.

const tourCard = (page: Page) => page.getByRole("dialog", { name: /Product tour/ });

test.describe("Landing page", () => {
  test("is public, explains the product with real screenshots and leads to the demo", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Run your delivery fleet from one control room." })).toBeVisible();

    for (const section of ["Every part of a delivery operation, connected.", "It does not just store your operation. It reads it.", "The right view for each person.", "A full-stack application, built to be read."]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    for (const preview of ["Fleet tracking", "Delivery management", "Route optimisation", "Analytics"]) {
      await expect(page.getByText(preview, { exact: true }).first()).toBeVisible();
    }
    // Technology highlights name the real stack.
    const stack = page.getByRole("list", { name: "Technology stack" });
    for (const tech of ["Next.js 16", "Prisma", "SQLite", "Socket.IO", "Leaflet", "Playwright"]) await expect(stack.getByText(tech, { exact: true })).toBeVisible();

    // The product imagery is actual screenshots of the application, and every one loads.
    const images = page.locator("figure img");
    await expect(images).toHaveCount(5);
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      expect(await img.getAttribute("alt")).toBeTruthy();
    }

    // Honest about what it is: no invented customers, and the simulation is disclosed.
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const claim of ["testimonial", "trusted by", "our customers", "% uptime", "award"]) expect(text, claim).not.toContain(claim);
    await expect(page.getByText(/independent software engineering project, not a\s+commercial service/)).toBeVisible();
    await expect(page.getByText(/built-in GPS simulator rather than tracking\s+hardware/)).toBeVisible();

    // Clear routes into the product.
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
    await page.getByRole("link", { name: "Explore the live demo" }).first().click();
    await expect(page).toHaveURL(/\/login#demo$/);
    await expect(page.getByRole("heading", { name: "Explore the demo" })).toBeVisible();
  });

  test("works on a phone without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try the demo" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto("/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("offers signed-in users a way straight back into the app", async ({ page }) => {
    await loginViaApi(page, "manager");
    await page.goto("/");
    await page.getByRole("link", { name: "Open the app" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("ignores unsafe post-login redirect targets", async ({ page }) => {
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByRole("button", { name: "Sign in as Dispatcher" }).click();
      await page.waitForURL("**/dashboard");
      expect(new URL(page.url()).host).toBe(`localhost:${process.env.E2E_PORT || 3100}`);
      // Leave the app before signing out: a signed-out page redirects itself to /login on its next
      // request, which would otherwise race with the navigation below.
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      await page.goto("about:blank");
      await page.request.post("/api/auth/logout");
    }
    // A normal in-app path is honoured.
    await page.goto("/login?next=%2Fdeliveries");
    await page.getByRole("button", { name: "Sign in as Dispatcher" }).click();
    await page.waitForURL("**/deliveries");
  });
});

test.describe("Demo access", () => {
  test("explains each role and signs in with one click", async ({ page }) => {
    await page.goto("/login");
    const expectations = [
      { key: "admin", role: "Super Admin", text: "User accounts and roles", home: "/dashboard", name: "Aarav Mehta" },
      { key: "manager", role: "Fleet Manager", text: "Fuel, maintenance and reminders", home: "/dashboard", name: "Priya Nair" },
      { key: "dispatcher", role: "Dispatcher", text: "Plan and optimise routes", home: "/dashboard", name: "Rohan Verma" },
      { key: "driver", role: "Driver", text: "Own performance, nothing else", home: "/my-deliveries", name: "Suresh Yadav" },
    ];
    for (const e of expectations) {
      const card = page.locator(`[data-demo-role="${e.key}"]`);
      await expect(card.getByRole("heading", { name: e.role })).toBeVisible();
      await expect(card.getByText(e.text)).toBeVisible();
    }
    for (const e of expectations) {
      await page.goto("/login");
      await page.getByRole("button", { name: `Sign in as ${e.role}` }).click();
      await page.waitForURL(`**${e.home}`);
      await expect(page.getByRole("button", { name: "Account menu" })).toContainText(e.name);
      // Every signed-in page says plainly that this is sample data.
      const banner = page.getByRole("note", { name: "Demo environment" });
      await expect(banner).toContainText("You are working with sample data");
      await expect(banner).toContainText("Vehicle movement is simulated");
      await expect(banner.getByRole("button", { name: "Reset demo data" })).toHaveCount(e.key === "driver" ? 0 : 1);
      // Leave the app before signing out (same reason as in the redirect test above): a signed-out
      // page redirects itself to /login?next=… on its next request, racing the goto below.
      await page.goto("about:blank");
      await page.request.post("/api/auth/logout");
    }
  });
});

test.describe("Guided product tour", () => {
  test("walks through the modules, can go back, and can be skipped", async ({ page }) => {
    await loginViaApi(page, "manager");
    await page.goto("/dashboard");
    // Offered, never forced: nothing covers the page until the visitor starts it.
    await expect(tourCard(page)).toHaveCount(0);
    await expect(page.getByText("New to LogiTrack?")).toBeVisible();
    await page.getByRole("button", { name: "Start tour" }).click();

    const steps = [
      ["Main dashboard", "/dashboard"], ["Fleet management", "/vehicles"], ["Driver management", "/drivers"], ["Delivery operations", "/deliveries"],
      ["Live tracking", "/tracking"], ["Route planning", "/routes"], ["Analytics and intelligence", "/analytics"],
      ["Import and export", "/import-export"],
    ] as const;
    for (let i = 0; i < steps.length; i++) {
      const [title, path] = steps[i];
      await expect(tourCard(page).getByRole("heading", { name: title })).toBeVisible();
      await expect(tourCard(page)).toContainText(`${i + 1} of ${steps.length}`);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // The page behind the card is the real, usable page.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (i < steps.length - 1) await tourCard(page).getByRole("button", { name: "Next" }).click();
    }
    // Back returns to the previous module.
    await tourCard(page).getByRole("button", { name: "Previous step" }).click();
    await expect(tourCard(page).getByRole("heading", { name: "Analytics and intelligence" })).toBeVisible();
    await expect(page).toHaveURL(/\/analytics$/);
    await tourCard(page).getByRole("button", { name: "Next" }).click();
    await tourCard(page).getByRole("button", { name: "Finish" }).click();
    await expect(tourCard(page)).toHaveCount(0);

    // Once taken it is not pushed again, but stays available from the account menu.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("New to LogiTrack?")).toHaveCount(0);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Product tour" }).click();
    await expect(tourCard(page).getByRole("heading", { name: "Main dashboard" })).toBeVisible();
    await tourCard(page).getByRole("button", { name: "Skip tour" }).first().click();
    await expect(tourCard(page)).toHaveCount(0);
  });

  test("can be declined, and adapts to the role", async ({ page }) => {
    await loginViaApi(page, "dispatcher");
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByText("New to LogiTrack?")).toHaveCount(0);
    // From the demo banner: a dispatcher's tour has no analytics or operations step (6 modules + import).
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(tourCard(page)).toContainText("1 of 7");
    await tourCard(page).getByRole("button", { name: "Skip tour" }).first().click();

    // A driver gets the driver's tour.
    await page.request.post("/api/auth/logout");
    await loginViaApi(page, "driver");
    await page.goto("/my-deliveries");
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(tourCard(page).getByRole("heading", { name: "My deliveries" })).toBeVisible();
    await expect(tourCard(page)).toContainText("1 of 2");
    await tourCard(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/my-performance$/);
    await tourCard(page).getByRole("button", { name: "Finish" }).click();
  });
});

test.describe("Delivery risk detection", () => {
  test("flags at-risk deliveries on the dashboard, in the list and on the delivery, with reasons", async ({ page }) => {
    await loginViaApi(page, "dispatcher");
    const overview = await apiGet<{ counts: { high: number; medium: number; low: number; total: number }; items: { id: string; code: string; risk: { level: string; reasons: string[] } }[] }>(page.request, "/api/intelligence/risk");
    expect(overview.counts.high).toBeGreaterThanOrEqual(1);
    expect(overview.counts.low).toBeGreaterThanOrEqual(1);
    expect(overview.counts.total).toBe(overview.counts.high + overview.counts.medium + overview.counts.low);
    for (const item of overview.items) expect(item.risk.reasons.length, item.code).toBeGreaterThan(0);
    const top = overview.items[0];
    expect(top.risk.level).toBe("HIGH");

    await page.goto("/dashboard");
    const card = page.getByRole("region", { name: "Deliveries at risk" });
    await expect(card.getByRole("link", { name: top.code })).toBeVisible();
    await expect(card.getByText("High risk").first()).toBeVisible();
    await expect(card.getByText(top.risk.reasons[0]).first()).toBeVisible();

    // The list shows a risk level for open deliveries and none for closed ones.
    await page.goto("/deliveries");
    await page.getByRole("tab", { name: "Active" }).click();
    await expect(page.getByRole("columnheader", { name: "Delay risk" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: top.code })).toContainText("High risk");
    await page.getByRole("tab", { name: "Closed" }).click();
    await expect(page.getByRole("row").nth(1)).not.toContainText(/risk/i);

    // The delivery page lists every reason and labels the estimate as rule-based.
    await page.goto(`/deliveries/${top.id}`);
    const panel = page.getByRole("region", { name: "Delay risk" });
    await expect(panel).toContainText("High risk");
    for (const reason of top.risk.reasons) await expect(panel.getByText(reason)).toBeVisible();
    await expect(panel).toContainText("Projected arrival");
    await expect(panel).toContainText("Rule-based estimate");
  });
});

test.describe("Analytics and intelligence", () => {
  test("compares periods, explains changes and surfaces fleet, fuel and maintenance insights", async ({ page }) => {
    await loginViaApi(page, "manager");
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();

    // Overview: the comparison is on by default and the changes are explained in words.
    await expect(page.getByLabel("Comparison period")).toHaveValue("previous");
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    await expect(page.getByText(/Compared with .* \(previous period\)/)).toBeVisible();
    for (const section of ["Delivery reliability", "Operational cost", "Fleet efficiency and driver productivity"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    await expect(page.getByTitle("Change against the comparison period").first()).toBeVisible();

    // The figures on screen are the API's figures.
    await page.getByLabel("Date range").selectOption("30d");
    const range = await page.evaluate(() => {
      const to = new Date();
      const from = new Date(to.getTime() - 29 * 86_400_000);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return `from=${iso(from)}&to=${iso(to)}`;
    });
    const api = await apiGet<{ summary: { totalDeliveries: number; onTimeRate: number }; comparison: { summary: { totalDeliveries: number } }; insights: string[] }>(page.request, `/api/analytics?${range}&compare=previous`);
    expect(api.comparison.summary.totalDeliveries).toBeGreaterThan(0);
    await expect(page.getByText(api.insights[0])).toBeVisible();
    const total = page.locator("div").filter({ has: page.getByText("Total deliveries", { exact: true }) }).last();
    await expect(total).toContainText(String(api.summary.totalDeliveries));

    await page.getByLabel("Comparison period").selectOption("year");
    await expect(page.getByText(/Compared with .* \(same period last year\)/)).toBeVisible();
    await expect(page.getByText("There were no deliveries in the comparison period, so changes cannot be calculated.")).toBeVisible();
    await page.getByLabel("Comparison period").selectOption("none");
    await expect(page.getByRole("heading", { name: "What changed" })).toHaveCount(0);

    // Fleet efficiency: utilisation figures and explained under-utilisation.
    await page.getByRole("tab", { name: "Fleet efficiency" }).click();
    for (const label of ["Vehicle utilisation", "Idle time", "Active vehicles", "Maintenance downtime", "Avg distance per vehicle", "Under-utilised vehicles"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Vehicle usage trend")).toBeVisible();
    const under = page.getByRole("region", { name: "Under-utilised vehicles" });
    await expect(under.getByText(/available days.*the fleet average is/).first()).toBeVisible();
    await expect(under).toContainText("System-generated");

    // Fuel efficiency: flags with reasons, and honesty about missing data.
    await page.getByRole("tab", { name: "Fuel efficiency" }).click();
    await expect(page.getByText("Fuel efficiency comparison")).toBeVisible();
    await expect(page.getByText(/Mileage fell \d+% on the last two fills/)).toBeVisible();
    await expect(page.getByText("Only one fuel record: mileage needs at least two fills with odometer readings.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Not enough data" }).first()).toBeVisible();
    await expect(page.getByText(/Electric vehicles are not included in mileage analysis: DL 1C AF 9914/)).toBeVisible();

    // Maintenance: cost analysis, and recommendations clearly marked as system suggestions.
    await page.getByRole("tab", { name: "Maintenance" }).click();
    await expect(page.getByText("Maintenance cost by type")).toBeVisible();
    const recommended = page.getByRole("region", { name: "Recommended services" });
    await expect(recommended).toContainText("Not yet scheduled");
    await expect(recommended).toContainText("System-generated");
    await expect(recommended.getByText(/Routine service/).first()).toBeVisible();

    await page.getByRole("tab", { name: "Drivers" }).click();
    await expect(page.getByText("Driver performance comparison")).toBeVisible();
    await expect(page.getByText("Deliveries per driver").first()).toBeVisible();
  });

  test("keeps recommendations separate from scheduled maintenance, and shows driver trends", async ({ page }) => {
    await loginViaApi(page, "manager");
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { name: "Scheduled and due" })).toBeVisible();
    const recommended = page.getByRole("region", { name: "Recommended services" });
    await expect(recommended).toContainText("System-generated");
    // "Schedule" only opens a pre-filled form; nothing is booked until it is saved.
    const before = await apiGet<{ total: number }>(page.request, "/api/maintenance?pageSize=1");
    await recommended.getByRole("button", { name: "Schedule" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Maintenance type")).toHaveValue("GENERAL_SERVICE");
    await expect(dialog.getByLabel("Description")).toHaveValue(/Routine service \(recommended:/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await apiGet<{ total: number }>(page.request, "/api/maintenance?pageSize=1")).total).toBe(before.total);

    await page.goto("/fuel");
    await expect(page.getByRole("heading", { name: "Fuel intelligence" })).toBeVisible();
    await expect(page.getByText(/Mileage fell \d+% on the last two fills/)).toBeVisible();

    await page.goto("/performance");
    await expect(page.getByText("Fleet benchmark")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "30-day trend" })).toBeVisible();
    // Drivers without enough history are not ranked and have no invented trend.
    await expect(page.getByText("Not rated").first()).toBeVisible();
    await expect(page.getByText("Not enough data").first()).toBeVisible();
    await page.getByRole("row").nth(1).click();
    await expect(page.getByRole("heading", { name: "Compared with the fleet" })).toBeVisible();
    await expect(page.getByText(/pts vs fleet|at fleet level/).first()).toBeVisible();
    await expect(page.getByText("Completion rate").first()).toBeVisible();
  });
});

test.describe("Demo controls", () => {
  test("restarts the simulated trips from their starting points", async ({ page }) => {
    await loginViaApi(page, "dispatcher");
    await page.goto("/tracking");
    await expect(page.getByText(/Simulator\s*paused/)).toBeVisible();
    type Snapshot = { vehicles: { registrationNumber: string; lat: number; delivery: { progress: number; moving: boolean; pickup: [number, number] } | null }[] };
    const before = (await apiGet<Snapshot>(page.request, "/api/tracking")).vehicles.filter((v) => v.delivery?.moving);
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(before.some((v) => v.delivery!.progress > 0.1)).toBe(true);

    await page.getByRole("button", { name: "Restart trips" }).click();
    await expect(toast(page, "Trips rewound to their starting points")).toBeVisible();
    await expect(page.getByText(/Simulator\s*running/)).toBeVisible();
    // Pause straight away so the check below is not racing the simulator.
    await page.getByRole("button", { name: "Pause simulation" }).click();
    await expect(page.getByText(/Simulator\s*paused/)).toBeVisible();

    const after = (await apiGet<Snapshot>(page.request, "/api/tracking")).vehicles.filter((v) => v.delivery?.moving);
    expect(after.length).toBe(before.length);
    for (const v of after) {
      // Back at (or a tick or two beyond) the pickup point.
      expect(v.delivery!.progress, v.registrationNumber).toBeLessThan(0.1);
    }
    expect((await page.request.post("/api/simulator", { data: { action: "explode" } })).status()).toBe(422);
  });

  test("resets the demo data on request and keeps the user signed in", async ({ page }) => {
    await loginViaApi(page, "manager");
    const registration = uniqueRegistration();
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
    await apiSend(page.request, "post", "/api/vehicles", {
      registrationNumber: registration, name: "Temporary Demo Van", type: "VAN", manufacturer: "Tata", model: "Winger", year: 2023, fuelType: "DIESEL",
      fuelCapacity: 60, odometer: 100, status: "AVAILABLE", insuranceExpiry: day(300), registrationExpiry: day(900), assignedDriverId: "", lastLat: "", lastLng: "",
    });
    const count = async () => (await apiGet<{ total: number }>(page.request, `/api/vehicles?q=${encodeURIComponent(registration)}`)).total;
    expect(await count()).toBe(1);
    const totalBefore = (await apiGet<{ total: number }>(page.request, "/api/vehicles?pageSize=1")).total;

    await page.goto("/vehicles");
    await page.getByRole("button", { name: "Reset demo data" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Changes made during this demo are discarded");
    // Cancelling changes nothing.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(await count()).toBe(1);

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await Promise.all([page.waitForEvent("load"), page.getByRole("alertdialog").getByRole("button", { name: "Reset demo data" }).click()]);

    // Still signed in, on fresh sample data.
    await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Priya Nair");
    expect(await count()).toBe(0);
    expect((await apiGet<{ total: number }>(page.request, "/api/vehicles?pageSize=1")).total).toBe(totalBefore - 1);
    await expect(page.getByRole("note", { name: "Demo environment" })).toContainText(/generated \d+ (second|minute)s? ago/);
    const status = await apiGet<{ enabled: boolean; seededAt: string; simulator: { running: boolean } }>(page.request, "/api/demo");
    expect(status.enabled).toBe(true);
    expect(Date.now() - new Date(status.seededAt).getTime()).toBeLessThan(120_000);
    // The reset is recorded in the audit log.
    const log = await apiGet<{ items: { description: string }[] }>(page.request, "/api/activity?entityType=Demo");
    expect(log.items[0].description).toBe("Priya Nair reset the demo data");

    // Drivers cannot reset the demo, through the UI or the API.
    await page.request.post("/api/auth/logout");
    await loginViaApi(page, "driver");
    expect((await page.request.post("/api/demo/reset")).status()).toBe(403);
    expect((await page.request.post("/api/simulator", { data: { action: "restart" } })).status()).toBe(403);
  });
});
