import { route } from "@/lib/api";
import { diagnostics } from "@/server/services/diagnostics";

/** Application, database, realtime, simulator and job health. Super Admin only. */
export const GET = route({ permission: "system:diagnostics" }, async () => diagnostics());
