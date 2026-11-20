import { route } from "@/lib/api";
import { vehicleSchema } from "@/lib/validation";
import { deleteVehicle, getVehicle, updateVehicle } from "@/server/services/vehicles";

export const GET = route({ permission: "vehicles:read" }, ({ params }) => getVehicle(params.id));
export const PUT = route({ permission: "vehicles:write", body: vehicleSchema }, ({ user, params, body }) => updateVehicle(user, params.id, body));
export const DELETE = route({ permission: "vehicles:write" }, ({ user, params }) => deleteVehicle(user, params.id));
