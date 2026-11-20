import "../src/server/env";
import { prisma } from "../src/lib/db";
import { DEMO_LOGINS, seedDemoData } from "../src/server/demo/seed";

// CLI entry point: `npm run db:seed`. The same generator powers the in-app "Reset demo data" action.
async function main() {
  console.log("Seeding LogiTrack demo data...");
  const s = await seedDemoData();
  console.log(
    `Done: ${s.users} users, ${s.drivers} drivers, ${s.vehicles} vehicles, ${s.deliveries} deliveries, ${s.fuelRecords} fuel records, ` +
      `${s.maintenanceRecords} maintenance records, ${s.notifications} notifications, ${s.activityEntries} activity entries.`,
  );
  console.log("\nDemo logins:");
  for (const u of DEMO_LOGINS) console.log(`  ${u.role.padEnd(14)} ${u.email.padEnd(28)} ${u.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
