import { route } from "@/lib/api";
import { driverOptions } from "@/server/services/drivers";

export const GET = route({ permission: ["drivers:read", "deliveries:write", "vehicles:write"] }, () => driverOptions());
