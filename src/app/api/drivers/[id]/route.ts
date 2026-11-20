import { route } from "@/lib/api";
import { driverSchema } from "@/lib/validation";
import { deleteDriver, getDriver, updateDriver } from "@/server/services/drivers";

export const GET = route({ permission: "drivers:read" }, ({ params }) => getDriver(params.id));
export const PUT = route({ permission: "drivers:write", body: driverSchema }, ({ user, params, body }) => updateDriver(user, params.id, body));
export const DELETE = route({ permission: "drivers:write" }, ({ user, params }) => deleteDriver(user, params.id));
