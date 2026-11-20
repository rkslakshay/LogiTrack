// Times a CSV preview and import of N deliveries through the real API.
//   npx tsx scripts/perf-import.ts http://localhost:3200 1000
const BASE = process.argv[2] ?? "http://localhost:3200";
const N = Number(process.argv[3] ?? 1000);

async function main() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email: "admin@logitrack.in", password: "Admin@123" }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.includes("lt_session"))!;
  const stamp = Date.now();
  const rows = ["Customer Name,Customer Phone,Pickup Address,Pickup Latitude,Pickup Longitude,Destination Address,Destination Latitude,Destination Longitude,Scheduled At,Expected At,Priority"];
  for (let i = 0; i < N; i++) {
    const day = new Date(stamp + (i % 30) * 86_400_000);
    const d = day.toISOString().slice(0, 10);
    rows.push(`Import Customer ${stamp}-${i},+91 98220 ${String(10000 + (i % 89999)).padStart(5, "0")},Wakad Pune,18.5987,73.7652,Drop ${stamp}-${i} Kharadi,18.5515,73.9348,${d} 09:00,${d} 13:00,Normal`);
  }
  const csv = rows.join("\n");
  const post = async (commit: boolean) => {
    const t = performance.now();
    const r = await fetch(`${BASE}/api/data/deliveries/import`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ csv, fileName: "perf.csv", commit }),
    });
    const body = await r.json();
    return { status: r.status, ms: Math.round(performance.now() - t), summary: body.data?.summary ?? body.error };
  };
  console.log(JSON.stringify({ rows: N, bytes: csv.length, preview: await post(false), commit: await post(true) }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export {};
