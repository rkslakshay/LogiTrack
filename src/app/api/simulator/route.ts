import { z } from "zod";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { restartDemoTrips } from "@/server/demo";
import { getSimulator } from "@/server/simulator";
import { logActivity } from "@/server/services/activity";

export const GET = route({ permission: "tracking:view" }, async () => getSimulator().state());

const schema = z.object({ action: z.enum(["start", "pause", "restart"]) });

/** Pause or resume the GPS simulation engine. */
export const POST = route({ permission: "simulator:control", body: schema }, async ({ user, body }) => {
  // "restart" rewinds the trips that are on the road (demo mode only).
  if (body.action === "restart") return (await restartDemoTrips(user)).simulator;
  const simulator = getSimulator();
  const state = body.action === "start" ? simulator.start() : simulator.pause();
  await logActivity(prisma, user, "SYSTEM", "Simulator", null, `${body.action === "start" ? "Resumed" : "Paused"} the GPS simulation`);
  return state;
});
