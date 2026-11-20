// Measures API response times, Socket.IO fan-out and memory against a RUNNING server.
// Use it with the synthetic dataset (npm run perf:seed) and a production build:
//
//   DATABASE_URL=file:./perf.db PORT=3200 npm start      (in one terminal)
//   npm run perf:bench -- http://localhost:3200          (in another)
//
// Results are printed and written to perf-results/<timestamp>.json. Nothing is
// estimated: every figure is a measured wall-clock time from this client.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { io, type Socket } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3200";
const RUNS = Number(process.env.RUNS ?? 20);
const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const from90 = ymd(new Date(today.getTime() - 90 * 86_400_000));
const from180 = ymd(new Date(today.getTime() - 180 * 86_400_000));

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password }) });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.includes("lt_session"));
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const r1 = (n: number) => Math.round(n * 10) / 10;

async function time(cookie: string, path: string, runs = RUNS) {
  const times: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < runs + 2; i++) {
    const t = performance.now();
    const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
    const body = await res.arrayBuffer();
    const ms = performance.now() - t;
    status = res.status;
    bytes = body.byteLength;
    if (i >= 2) times.push(ms); // two warm-up requests are discarded
  }
  times.sort((a, b) => a - b);
  return { path, status, runs, medianMs: r1(pct(times, 50)), p95Ms: r1(pct(times, 95)), maxMs: r1(times[times.length - 1]), responseKb: r1(bytes / 1024) };
}

async function concurrent(cookie: string, path: string, clients: number, perClient: number) {
  const started = performance.now();
  const times: number[] = [];
  await Promise.all(
    Array.from({ length: clients }, async () => {
      for (let i = 0; i < perClient; i++) {
        const t = performance.now();
        const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
        await res.arrayBuffer();
        times.push(performance.now() - t);
      }
    }),
  );
  times.sort((a, b) => a - b);
  const total = (performance.now() - started) / 1000;
  return { path, clients, requests: times.length, medianMs: r1(pct(times, 50)), p95Ms: r1(pct(times, 95)), throughputPerSec: r1(times.length / total) };
}

async function diagnostics(cookie: string) {
  const res = await fetch(`${BASE}/api/diagnostics`, { headers: { Cookie: cookie } });
  return (await res.json()).data as { app: { memory: { rssMb: number; heapUsedMb: number } }; simulator: { ticks: number; lastTickDurationMs: number | null; movingVehicles: number } };
}

async function sockets(cookie: string, count: number, seconds: number) {
  const clients: Socket[] = [];
  let received = 0;
  const latencies: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: cookie, Origin: BASE }, reconnection: false });
    s.on("vehicle:location", (p: { at: string }) => {
      received++;
      latencies.push(Date.now() - new Date(p.at).getTime());
    });
    clients.push(s);
  }
  await Promise.all(clients.map((s) => new Promise<void>((ok, fail) => (s.connected ? ok() : (s.once("connect", () => ok()), s.once("connect_error", fail))))));
  const post = (action: string) =>
    fetch(`${BASE}/api/simulator`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ action }) });
  const before = await diagnostics(cookie);
  await post("start");
  received = 0;
  latencies.length = 0;
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const after = await diagnostics(cookie);
  await post("pause");
  for (const s of clients) s.disconnect();
  latencies.sort((a, b) => a - b);
  const ticks = after.simulator.ticks - before.simulator.ticks;
  return {
    clients: count, seconds, ticks, movingVehicles: after.simulator.movingVehicles, eventsReceived: received,
    eventsPerSecond: r1(received / seconds), lastTickDurationMs: after.simulator.lastTickDurationMs,
    deliveryLatencyMedianMs: latencies.length ? pct(latencies, 50) : null, deliveryLatencyP95Ms: latencies.length ? pct(latencies, 95) : null,
    rssMbBefore: before.app.memory.rssMb, rssMbAfter: after.app.memory.rssMb,
  };
}

async function main() {
  const admin = await login("admin@logitrack.in", "Admin@123");
  if (process.env.ONLY === "sockets") {
    console.log("sockets", await sockets(admin, Number(process.env.SOCKETS ?? 50), Number(process.env.SOCKET_SECONDS ?? 20)));
    return;
  }
  const driver = await login("driver@logitrack.in", "Driver@123");
  const memStart = (await diagnostics(admin)).app.memory;
  const endpoints = [
    "/api/dashboard",
    "/api/vehicles?page=1&pageSize=20",
    "/api/vehicles?page=5&pageSize=20&q=PF",
    "/api/drivers?page=1&pageSize=20",
    "/api/deliveries?page=1&pageSize=20",
    "/api/deliveries?page=10&pageSize=20&status=DELIVERED",
    `/api/deliveries?page=1&pageSize=20&from=${from90}&to=${ymd(today)}&q=Traders`,
    "/api/tracking",
    `/api/analytics?from=${from90}&to=${ymd(today)}`,
    `/api/analytics?from=${from180}&to=${ymd(today)}&compare=previous`,
    `/api/performance?from=${from90}&to=${ymd(today)}`,
    `/api/fuel?page=1&pageSize=20`,
    `/api/fuel/summary?from=${from90}&to=${ymd(today)}`,
    "/api/maintenance?page=1&pageSize=20",
    "/api/intelligence/fleet",
    "/api/intelligence/fuel",
    "/api/notifications?page=1&pageSize=20",
    "/api/activity?page=1&pageSize=20",
    `/api/reports/deliveries?from=${from180}&to=${ymd(today)}`,
    "/api/data/deliveries/export",
  ];
  const results = [];
  for (const path of endpoints) {
    const r = await time(admin, path);
    results.push(r);
    console.log(`${String(r.status).padEnd(4)} ${r.path.padEnd(70)} median ${String(r.medianMs).padStart(7)} ms  p95 ${String(r.p95Ms).padStart(7)} ms  ${r.responseKb} KB`);
  }
  const driverView = await time(driver, "/api/deliveries?page=1&pageSize=20");
  console.log(`driver /api/deliveries median ${driverView.medianMs} ms`);
  const load = [await concurrent(admin, "/api/dashboard", 10, 10), await concurrent(admin, "/api/deliveries?page=1&pageSize=20", 10, 10)];
  for (const l of load) console.log(`concurrent ${l.path}: ${l.clients} clients, median ${l.medianMs} ms, p95 ${l.p95Ms} ms, ${l.throughputPerSec} req/s`);
  const ws = await sockets(admin, Number(process.env.SOCKETS ?? 50), Number(process.env.SOCKET_SECONDS ?? 20));
  console.log("sockets", ws);
  const memEnd = (await diagnostics(admin)).app.memory;

  const report = {
    measuredAt: new Date().toISOString(),
    base: BASE,
    environment: { node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: r1(os.totalmem() / 1024 ** 3) },
    runsPerEndpoint: RUNS,
    endpoints: results,
    driverView,
    concurrency: load,
    sockets: ws,
    serverMemory: { start: memStart, end: memEnd },
  };
  mkdirSync("perf-results", { recursive: true });
  const file = `perf-results/bench-${report.measuredAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nSaved ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
