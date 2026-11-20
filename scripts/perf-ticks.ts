// Watches the simulator's tick counter through /api/diagnostics while it runs, to check
// that ticks keep their 2-second cadence under load.
//   npx tsx scripts/perf-ticks.ts http://localhost:3200
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3200";

async function main() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email: "admin@logitrack.in", password: "Admin@123" }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.includes("lt_session"))!;
  const s = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: cookie, Origin: BASE } });
  await new Promise<void>((ok) => s.once("connect", () => ok()));
  const post = (action: string) => fetch(`${BASE}/api/simulator`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ action }) });
  await post("start");
  for (let i = 0; i < 12; i++) {
    const d = (await (await fetch(`${BASE}/api/diagnostics`, { headers: { Cookie: cookie } })).json()).data;
    console.log(new Date().toISOString().slice(11, 19), "ticks", d.simulator.ticks, "failures", d.simulator.failures, "last", d.simulator.lastTickDurationMs, "ms", "moving", d.simulator.movingVehicles, "idle", d.simulator.waitingForViewers, d.simulator.lastError ?? "");
    await new Promise((r) => setTimeout(r, 1000));
  }
  await post("pause");
  s.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
