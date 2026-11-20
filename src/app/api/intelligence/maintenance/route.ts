import { route } from "@/lib/api";
import { maintenanceIntelligence } from "@/server/services/intelligence";

/** System-generated service recommendations (separate from scheduled maintenance). */
export const GET = route({ permission: "maintenance:read" }, () => maintenanceIntelligence());
