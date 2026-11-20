import { parseListQuery, route } from "@/lib/api";
import { vehicleSchema } from "@/lib/validation";
import { createVehicle, listVehicles } from "@/server/services/vehicles";

export const GET = route({ permission: "vehicles:read" }, ({ query }) =>
  listVehicles(parseListQuery(query), { type: query.get("type"), status: query.get("status"), fuelType: query.get("fuelType") }),
);

export const POST = route({ permission: "vehicles:write", body: vehicleSchema }, ({ user, body }) => createVehicle(user, body));
