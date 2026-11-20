import { parseListQuery, route } from "@/lib/api";
import { fuelSchema } from "@/lib/validation";
import { createFuel, listFuel } from "@/server/services/fuel";

export const GET = route({ permission: "fuel:read" }, ({ query }) => listFuel(parseListQuery(query), { vehicleId: query.get("vehicleId") }));
export const POST = route({ permission: "fuel:write", body: fuelSchema }, ({ user, body }) => createFuel(user, body));
