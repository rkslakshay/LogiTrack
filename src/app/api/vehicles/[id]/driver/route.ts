import { z } from "zod";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { setVehicleDriver } from "@/server/services/vehicles";

const schema = z.object({ driverId: z.string().min(1).nullable() });

/** Assign (or with driverId: null, release) the regular driver of a vehicle. */
export const PUT = route({ permission: ["vehicles:write", "drivers:write"], body: schema }, ({ user, params, body }) =>
  prisma.$transaction((tx) => setVehicleDriver(tx, user, params.id, body.driverId)),
);
