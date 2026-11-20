import { route } from "@/lib/api";
import { fuelSchema } from "@/lib/validation";
import { deleteFuel, updateFuel } from "@/server/services/fuel";

export const PUT = route({ permission: "fuel:write", body: fuelSchema }, ({ user, params, body }) => updateFuel(user, params.id, body));
export const DELETE = route({ permission: "fuel:write" }, ({ user, params }) => deleteFuel(user, params.id));
