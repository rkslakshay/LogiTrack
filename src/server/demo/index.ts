import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { emitStaff, EVENTS, getIo } from "@/lib/realtime";
import { parseGeometry } from "@/lib/routing";
import { logActivity } from "@/server/services/activity";
import { getSimulator } from "@/server/simulator";
import { seedDemoData } from "./seed";

/**
 * Demo mode is a property of the deployment (DEMO_MODE env var, on by default).
 * It only adds things: the sample-data banner, one-click demo logins, the reset
 * action and the "idle while nobody is watching" simulator gate. Business logic
 * is identical in both modes.
 */
export const isDemoMode = () => process.env.DEMO_MODE !== "false";

export function assertDemoMode() {
  if (!isDemoMode()) throw forbidden("This action is only available in demo mode.");
}

export async function demoStatus() {
  const row = await prisma.setting.findUnique({ where: { key: "demoSeededAt" } });
  return { enabled: isDemoMode(), seededAt: row?.value ?? null, simulator: getSimulator().state() };
}

let resetting: Promise<unknown> | null = null;

/**
 * Rebuilds the sample dataset through the same generator as `npm run db:seed`.
 * Real database work, not a trick: every table is emptied and repopulated, and
 * the demo accounts keep their IDs so signed-in users stay signed in.
 */
export async function resetDemoData(actor: SessionUser) {
  assertDemoMode();
  // Two people pressing the button at once must not interleave two rebuilds.
  if (resetting) throw forbidden("A demo reset is already in progress. Please wait a moment.");
  const simulator = getSimulator();
  const wasRunning = simulator.running;
  simulator.pause();
  const job = (async () => {
    const summary = await seedDemoData();
    await logActivity(prisma, actor, "SYSTEM", "Demo", null, `${actor.name} reset the demo data`);
    return summary;
  })();
  resetting = job;
  try {
    const summary = await job;
    simulator.reset();
    if (wasRunning || process.env.SIMULATOR_AUTOSTART !== "false") simulator.start();
    // Tell every open page to reload its data.
    getIo()?.emit(EVENTS.demoReset, { at: summary.seededAt });
    return summary;
  } finally {
    resetting = null;
  }
}

/**
 * Rewinds every trip that is currently on the road to its starting point and
 * (re)starts the simulator, so a demonstration can begin from the top.
 */
export async function restartDemoTrips(actor: SessionUser) {
  assertDemoMode();
  const simulator = getSimulator();
  const moving = await prisma.delivery.findMany({
    where: { pickedUpAt: { not: null }, status: { in: ["IN_TRANSIT", "DELAYED"] }, vehicleId: { not: null } },
    select: { id: true, vehicleId: true, pickupLat: true, pickupLng: true, routeGeometry: true },
  });
  const now = new Date();
  for (const d of moving) {
    const start = parseGeometry(d.routeGeometry)[0] ?? [d.pickupLat, d.pickupLng];
    await prisma.$transaction([
      prisma.delivery.update({ where: { id: d.id }, data: { progress: 0 } }),
      prisma.vehicle.update({ where: { id: d.vehicleId! }, data: { lastLat: start[0], lastLng: start[1], lastHeading: 0, lastLocationAt: now } }),
    ]);
  }
  await logActivity(prisma, actor, "SYSTEM", "Simulator", null, `Restarted the GPS simulation (${moving.length} trip${moving.length === 1 ? "" : "s"} rewound)`);
  simulator.reset();
  const state = simulator.start();
  emitStaff(EVENTS.deliveryUpdated, { restarted: true });
  return { restarted: moving.length, simulator: state };
}
