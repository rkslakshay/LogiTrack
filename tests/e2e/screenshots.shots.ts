import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { loginViaApi, selectContaining } from "./helpers";

// Captures the screenshot collection from the running application: `npm run screenshots`.
// The images are used by the landing page and the README. Nothing here is mocked:
// every picture is the real app on the seeded sample data.
// Not part of the test suite (it only runs when SHOTS=1, see playwright.config.ts).

// Raw captures; `scripts/optimize-screenshots.mjs` publishes them (docs/assets/screenshots + landing images).
const DIR = "test-results/screenshots";
mkdirSync(DIR, { recursive: true });

async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  // Let charts, map tiles and web fonts settle.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: options.fullPage });
}

/** The tour invitation and demo bar are part of the product, but the tour prompt would repeat in every picture. */
async function dismissTourPrompt(page: Page) {
  await page.evaluate(() => window.localStorage.setItem("logitrack:tour-done", "1"));
}

test("capture the screenshot collection", async ({ page }) => {
  test.setTimeout(900_000);

  // --- Application screens (captured first: the landing page embeds some of them) ---
  await loginViaApi(page, "admin");
  await page.goto("/dashboard");
  await dismissTourPrompt(page);
  await page.goto("/dashboard");
  await page.getByText("Delivery performance").waitFor();
  await page.getByRole("region", { name: "Deliveries at risk" }).waitFor();
  await shot(page, "dashboard");

  await page.goto("/vehicles");
  await page.getByRole("row").nth(3).waitFor();
  await shot(page, "vehicles");

  await page.goto("/drivers");
  await page.getByRole("row").nth(3).waitFor();
  await shot(page, "drivers");

  await page.goto("/tracking");
  await page.getByRole("button", { name: /MH 04 KF 4821/ }).last().click();
  await page.getByText("Chakan MIDC, Pune").first().waitFor();
  await page.waitForTimeout(4000);
  await shot(page, "tracking");

  await page.goto("/deliveries");
  await page.getByRole("tab", { name: "Active" }).click();
  await page.getByRole("row").nth(3).waitFor();
  await shot(page, "deliveries");

  await page.getByRole("row").filter({ hasText: "In Transit" }).first().getByRole("link").first().click();
  await page.getByText("Delivery history").waitFor();
  await page.waitForTimeout(3000);
  await shot(page, "delivery-detail");

  await page.goto("/routes");
  await selectContaining(page.getByLabel("Start point (depot or vehicle location)"), "Cyber City");
  for (const text of ["IMT Manesar", "Cyber City, DLF Phase 2"]) {
    await page.getByRole("listitem").filter({ hasText: text }).first().getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "Optimise route" }).click();
  await page.getByText("3. Review the route").waitFor();
  await page.waitForTimeout(3000);
  await shot(page, "routes");

  await page.goto("/analytics");
  await page.getByRole("heading", { name: "What changed" }).waitFor();
  await shot(page, "analytics");

  await page.getByRole("tab", { name: "Fleet efficiency" }).click();
  await page.getByText("Vehicle usage trend").waitFor();
  await shot(page, "analytics-fleet");

  await page.getByRole("tab", { name: "Fuel efficiency" }).click();
  await page.getByText("Fuel efficiency comparison").waitFor();
  await shot(page, "analytics-fuel");

  await page.goto("/performance");
  await page.getByText("Leaderboard").waitFor();
  await shot(page, "performance");

  await page.goto("/fuel");
  await page.getByText("Vehicle-wise fuel analysis").waitFor();
  await shot(page, "fuel");

  await page.goto("/maintenance");
  await page.getByRole("region", { name: "Recommended services" }).waitFor();
  await shot(page, "maintenance");

  // The guided tour in progress.
  await page.goto("/deliveries");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Product tour" }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("dialog", { name: /Product tour/ }).getByRole("button", { name: "Next" }).click();
  await page.getByRole("dialog", { name: /Delivery operations/ }).waitFor();
  await shot(page, "tour");
  await page.getByRole("dialog", { name: /Product tour/ }).getByRole("button", { name: "Skip tour" }).first().click();

  // --- Driver portal ---
  await page.request.post("/api/auth/logout");
  await loginViaApi(page, "driver");
  await page.goto("/my-deliveries");
  await page.getByRole("heading", { name: "My Deliveries" }).waitFor();
  await shot(page, "driver-portal");

  // --- Public pages ---
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByRole("heading", { name: "Explore the demo" }).waitFor();
  await shot(page, "login");

  await page.goto("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await shot(page, "landing");
  // Full-page version: reveal everything first (sections fade in on scroll).
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible")));
  await shot(page, "landing-full", { fullPage: true });
});
