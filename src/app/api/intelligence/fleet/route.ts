import { parseRange, route } from "@/lib/api";
import { fleetIntelligence } from "@/server/services/intelligence";

/** Utilisation, idle time, maintenance downtime and under-utilised vehicles. */
export const GET = route({ permission: "analytics:view" }, ({ query }) => fleetIntelligence(parseRange(query, 30)));
