// Walks through LogiTrack as each demo role, in a real browser, and reports console errors,
// failed requests and pages that redirect away. Optional screenshots for manual review.
//   npx tsx scripts/review-walkthrough.ts http://localhost:3001 [outDir]
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3001";
const OUT = process.argv[3] ?? null;

const ROLES: Record<string, { email: string; password: string; pages: string[] }> = {
  admin: { email: "admin@logitrack.in", password: "Admin@123", pages: ["/dashboard", "/users", "/settings", "/backups", "/diagnostics", "/import-export", "/activity"] },
  manager: { email: "manager@logitrack.in", password: "Manager@123", pages: ["/dashboard", "/vehicles", "/drivers", "/fuel", "/maintenance", "/analytics", "/performance", "/reports", "/import-export"] },
  dispatcher: { email: "dispatcher@logitrack.in", password: "Dispatch@123", pages: ["/dashboard", "/deliveries", "/tracking", "/routes", "/notifications", "/import-export"] },
  driver: { email: "driver@logitrack.in", password: "Driver@123", pages: ["/my-deliveries", "/my-performance", "/notifications", "/settings"] },
};
// Pages a role must NOT reach (it should be redirected away).
const FORBIDDEN: Record<string, string[]> = {
  manager: ["/users", "/backups", "/diagnostics"],
  dispatcher: ["/users", "/backups", "/diagnostics", "/fuel", "/analytics"],
  driver: ["/dashboard", "/vehicles", "/import-export", "/backups", "/diagnostics"],
};

async function main() {
  if (OUT) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "msedge" });
  const problems: string[] = [];
  for (const [role, cfg] of Object.entries(ROLES)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`[${role}] console error on ${page.url()}: ${m.text().slice(0, 200)}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 500) problems.push(`[${role}] ${r.status()} ${r.url()}`);
    });
    const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: cfg.email, password: cfg.password } });
    if (res.status() !== 200) {
      problems.push(`[${role}] login failed: ${res.status()}`);
      continue;
    }
    await page.goto(`${BASE}/dashboard`);
    // Wait until navigation (a driver is redirected to /my-deliveries) has settled.
    await page.locator("main h1").first().waitFor({ timeout: 60_000 });
    await page.evaluate(() => window.localStorage.setItem("logitrack:tour-done", "1"));
    for (const path of cfg.pages) {
      await page.goto(BASE + path);
      await page.locator("main h1").first().waitFor({ timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      const at = new URL(page.url()).pathname;
      if (at !== path) problems.push(`[${role}] ${path} redirected to ${at}`);
      const h1 = await page.locator("main h1").first().textContent().catch(() => null);
      const errorUi = await page.getByText(/Something went wrong|Application error|Unhandled Runtime Error/).count();
      if (errorUi) problems.push(`[${role}] error UI on ${path}`);
      console.log(`${role.padEnd(10)} ${path.padEnd(16)} -> ${at.padEnd(16)} h1="${h1 ?? ""}"`);
      if (OUT) await page.screenshot({ path: `${OUT}/${role}-${path.replace(/\//g, "_")}.png` });
    }
    for (const path of FORBIDDEN[role] ?? []) {
      await page.goto(BASE + path);
      const at = new URL(page.url()).pathname;
      if (at === path) problems.push(`[${role}] could open forbidden page ${path}`);
      else console.log(`${role.padEnd(10)} ${path.padEnd(16)} -> ${at.padEnd(16)} (refused, as expected)`);
    }
    await context.close();
  }
  await browser.close();
  console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nNo problems found.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export {};
