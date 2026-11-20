// Measures how long the Live Tracking map takes to show every vehicle, in a real browser.
//   npx tsx scripts/perf-map.ts http://localhost:3200      (PW_CHANNEL=msedge to use Edge)
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3200";
const RUNS = Number(process.env.RUNS ?? 5);

async function main() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: "admin@logitrack.in", password: "Admin@123" } });
  if (login.status() !== 200) throw new Error(`login failed: ${login.status()}`);
  const expected = (await (await page.request.get(`${BASE}/api/tracking`)).json()).data.vehicles.filter((v: { lat: number | null }) => v.lat != null).length;

  const times: number[] = [];
  let heapMb = 0;
  for (let i = 0; i < RUNS + 1; i++) {
    const t = Date.now();
    await page.goto(`${BASE}/tracking`);
    await page.waitForFunction((n) => document.querySelectorAll(".leaflet-marker-icon").length >= n, expected, { timeout: 60_000 });
    if (i > 0) times.push(Date.now() - t); // first load warms the server's caches
    heapMb = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1024 / 1024);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ vehiclesWithPosition: expected, runs: RUNS, medianMs: times[Math.floor(RUNS / 2)], maxMs: times.at(-1), jsHeapMb: Math.round(heapMb * 10) / 10 }));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
