import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginViaApi, loginViaUi, type RoleKey } from "./helpers";

// LogiTrack 3.0: hardening, operations and data import, checked over real HTTP and in the browser.

test.describe("Security headers and CSP", () => {
  test("pages carry a nonce-based CSP and the hardening headers", async ({ page }) => {
    const res = await page.goto("/login");
    const h = res!.headers();
    const csp = h["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["x-powered-by"]).toBeUndefined();
    // Every inline script Next.js renders carries the nonce.
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    // Executable inline scripts only (JSON data blocks are inert and need no nonce).
    const inline = await page
      .locator("script:not([src])")
      .evaluateAll((els) => (els as HTMLScriptElement[]).filter((e) => (!e.type || /javascript|module/.test(e.type)) && !!e.textContent?.trim()).map((e) => e.nonce));
    expect(inline.length).toBeGreaterThan(0);
    for (const n of inline) expect(n).toBe(nonce);
  });

  test("the app runs without CSP violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text());
    });
    await loginViaUi(page, "admin");
    for (const path of ["/dashboard", "/tracking", "/analytics", "/diagnostics"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
    expect(violations).toEqual([]);
  });
});

test.describe("API access control inventory", () => {
  const PROTECTED = [
    "/api/dashboard", "/api/vehicles", "/api/drivers", "/api/deliveries", "/api/tracking", "/api/analytics", "/api/fuel", "/api/maintenance",
    "/api/performance", "/api/notifications", "/api/activity", "/api/users", "/api/settings", "/api/routes", "/api/reports/deliveries",
    "/api/intelligence/fleet", "/api/profile/mfa", "/api/profile/sessions", "/api/backups", "/api/diagnostics", "/api/data",
    "/api/data/vehicles/export", "/api/data/vehicles/template", "/api/simulator",
  ];

  test("every data endpoint refuses anonymous requests; only health is public", async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT || 3100}` });
    for (const path of PROTECTED) expect((await anon.get(path)).status(), path).toBe(401);
    const health = await anon.get("/api/health");
    expect(health.status()).toBe(200);
    expect(Object.keys(await health.json()).sort()).toEqual(["database", "responseMs", "status", "version"]);
    await anon.dispose();
  });

  for (const role of ["manager", "dispatcher", "driver"] as RoleKey[]) {
    test(`${role} cannot reach backups or diagnostics`, async ({ page }) => {
      await loginViaApi(page, role);
      for (const path of ["/api/backups", "/api/diagnostics"]) expect((await page.request.get(path)).status(), path).toBe(403);
      expect((await page.request.post("/api/backups", { data: {} })).status()).toBe(403);
      await page.goto("/diagnostics");
      await expect(page).not.toHaveURL(/\/diagnostics/);
      await page.goto("/backups");
      await expect(page).not.toHaveURL(/\/backups/);
    });
  }

  test("a driver cannot import or export fleet data", async ({ page }) => {
    await loginViaApi(page, "driver");
    expect((await page.request.get("/api/data/vehicles/export")).status()).toBe(403);
    const res = await page.request.post("/api/data/vehicles/import", { data: { csv: "a\n1" } });
    expect(res.status()).toBe(403);
  });
});

test.describe("Operations pages", () => {
  test("Super Admin sees live diagnostics and can create a verified backup", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/diagnostics");
    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await expect(page.getByText("Accepting connections")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

    await page.goto("/backups");
    await page.getByRole("button", { name: "Back up now" }).click();
    await expect(page.getByText(/created and verified/)).toBeVisible();
    await expect(page.getByRole("table", { name: "Database backups" }).getByText("OK").first()).toBeVisible();
    await page.getByRole("button", { name: "Check database" }).click();
    await expect(page.getByText("The live database passed its integrity check.")).toBeVisible();
  });

  test("an invalid password reset link is refused", async ({ page }) => {
    await page.goto(`/reset-password#token=${"a".repeat(64)}`);
    await page.getByLabel(/^New password/).fill("Long-Route-2026");
    await page.getByLabel("Confirm new password").fill("Long-Route-2026");
    await page.getByRole("button", { name: /set new password|reset password/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /invalid or has expired/ })).toBeVisible();
  });
});

test.describe("CSV import", () => {
  test("Fleet Manager previews a file with an error, skips it and imports the rest", async ({ page }) => {
    await loginViaUi(page, "manager");
    await page.goto("/import-export");
    await expect(page.getByRole("heading", { name: "Import & Export" })).toBeVisible();
    await page.getByLabel("Data type").first().selectOption("vehicles");
    const csv = [
      "Registration Number,Name,Type,Manufacturer,Model,Year,Fuel Type,Fuel Capacity (L),Odometer (km),Insurance Expiry,Registration Expiry",
      "MH 12 EE 7001,E2E Van One,Van,Tata,Winger,2023,Diesel,60,1000,2027-03-31,2034-03-31",
      "MH 12 EE 7002,E2E Van Two,Hovercraft,Tata,Winger,2023,Diesel,60,1000,2027-03-31,2034-03-31",
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles({ name: "vans.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("1 ready")).toBeVisible();
    await expect(page.getByText("1 with errors")).toBeVisible();
    await expect(page.getByText(/"Hovercraft" is not one of/)).toBeVisible();
    const importButton = page.getByRole("button", { name: /^Import 1 vehicle$/ });
    await expect(importButton).toBeDisabled();
    await page.getByLabel(/Skip the 1 rows with problems/).check();
    await importButton.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

    const list = await page.request.get("/api/vehicles?q=EE%207001");
    expect((await list.json()).data.total).toBe(1);
    const missing = await page.request.get("/api/vehicles?q=EE%207002");
    expect((await missing.json()).data.total).toBe(0);
  });
});

test.describe("Accessibility (axe)", () => {
  const PAGES: Record<RoleKey, string[]> = {
    admin: ["/dashboard", "/users", "/settings", "/backups", "/diagnostics"],
    manager: ["/vehicles", "/drivers", "/fuel", "/maintenance", "/analytics", "/reports", "/import-export"],
    dispatcher: ["/deliveries", "/tracking", "/routes", "/notifications"],
    driver: ["/my-deliveries", "/my-performance"],
  };

  test("public pages have no serious or critical violations", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });

  for (const [role, paths] of Object.entries(PAGES) as [RoleKey, string[]][]) {
    test(`${role} pages have no serious or critical violations`, async ({ page }) => {
      await loginViaApi(page, role);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".leaflet-container").analyze();
        const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
      }
    });
  }
});
