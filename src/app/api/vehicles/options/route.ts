import { route } from "@/lib/api";
import { vehicleOptions } from "@/server/services/vehicles";

export const GET = route({ permission: ["vehicles:read", "deliveries:write", "fuel:read", "maintenance:read"] }, () => vehicleOptions());
