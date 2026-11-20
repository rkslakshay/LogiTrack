import { route } from "@/lib/api";
import { getSimulator } from "@/server/simulator";
import { fleetSnapshot } from "@/server/services/tracking";

export const GET = route({ permission: "tracking:view" }, async () => ({
  vehicles: await fleetSnapshot(),
  simulator: getSimulator().state(),
  generatedAt: new Date().toISOString(),
}));
