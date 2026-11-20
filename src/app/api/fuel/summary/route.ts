import { parseListQuery, route } from "@/lib/api";
import { fuelSummary } from "@/server/services/fuel";

export const GET = route({ permission: "fuel:read" }, ({ query }) => fuelSummary(parseListQuery(query), { vehicleId: query.get("vehicleId") }));
