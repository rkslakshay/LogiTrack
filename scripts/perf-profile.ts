// Times individual service functions directly against the performance database
// (no HTTP), to find which part of a slow endpoint costs the time.
//
//   npm run perf:profile
process.env.DATABASE_URL ??= "file:./perf.db";
process.env.LOG_LEVEL ??= "error";

async function main() {
  const { prisma } = await import("../src/lib/db");
  const analytics = await import("../src/server/services/analytics");
  const maintenance = await import("../src/server/services/maintenance");
  const intelligence = await import("../src/server/services/intelligence");
  const { getSimulator } = await import("../src/server/simulator");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const user = { id: admin.id, name: admin.name, email: admin.email, phone: null, role: "SUPER_ADMIN" as const, driverId: null };
  const range = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date() };

  const time = async (label: string, fn: () => Promise<unknown>, runs = 10) => {
    await fn();
    const t: number[] = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      await fn();
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    console.log(`${label.padEnd(36)} median ${t[Math.floor(runs / 2)].toFixed(1).padStart(7)} ms   min ${t[0].toFixed(1).padStart(7)} ms`);
  };

  await time("getDashboard", () => analytics.getDashboard(user, range));
  await time("maintenanceAlerts", () => maintenance.maintenanceAlerts());
  await time("complianceAlerts", () => maintenance.complianceAlerts());
  await time("fuelIntelligence", () => intelligence.fuelIntelligence(range));
  await time("fleetIntelligence", () => intelligence.fleetIntelligence(range));
  const sim = getSimulator();
  await time("simulator.tick (40 moving)", () => sim.tick(2000), 5);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export {};
