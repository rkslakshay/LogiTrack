import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { loginViaApi } from "./helpers";

// Screenshots of the LogiTrack 3.0 pages, from the running app on the seeded sample data.
//   npx cross-env SHOTS=1 playwright test tests/e2e/v3.shots.ts

// Raw captures; `scripts/optimize-screenshots.mjs` publishes them (docs/assets/screenshots + landing images).
const DIR = "test-results/screenshots";
mkdirSync(DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test("capture the 3.0 screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await loginViaApi(page, "admin");
  await page.goto("/dashboard");
  await page.evaluate(() => window.localStorage.setItem("logitrack:tour-done", "1"));

  // Import with a preview that contains one problem row.
  await page.goto("/import-export");
  await page.getByLabel("Data type").first().selectOption("vehicles");
  const csv = [
    "Registration Number,Name,Type,Manufacturer,Model,Year,Fuel Type,Fuel Capacity (L),Odometer (km),Status,Insurance Expiry,Registration Expiry",
    "MH 12 RT 4101,Pune Van 21,Van,Tata,Winger,2023,Diesel,60,12450,Available,2027-03-31,2034-03-31",
    "MH 12 RT 4102,Pune Mini 22,Mini Truck,Tata,Ace Gold,2022,Diesel,30,30410,Available,2027-01-15,2033-11-30",
    "MH 12 RT 4103,Pune Van 23,Van,Force,Traveller,1987,Diesel,70,8000,Available,2027-02-28,2034-02-28",
    "MH 12 RT 4101,Pune Van 21,Van,Tata,Winger,2023,Diesel,60,12450,Available,2027-03-31,2034-03-31",
    "MH 14 RT 4104,Chakan Truck 24,Truck,Ashok Leyland,Ecomet 1615,2021,Diesel,185,64200,Maintenance,2026-12-20,2032-08-31",
  ].join("\n");
  await page.getByLabel("CSV file").setInputFiles({ name: "new-vehicles.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByText("3 ready").waitFor();
  await shot(page, "import-export");

  await page.goto("/backups");
  await page.getByRole("button", { name: "Back up now" }).click();
  await page.getByText(/created and verified/).waitFor();
  await page.waitForTimeout(4500); // let the toast disappear
  await shot(page, "backups");

  await page.goto("/diagnostics");
  await page.getByText("Accepting connections").waitFor();
  await shot(page, "diagnostics");

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Security" }).click();
  await page.getByText("Two-factor authentication").first().waitFor();
  await shot(page, "security-settings");
});
