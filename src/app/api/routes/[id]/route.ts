import { route } from "@/lib/api";
import { deleteRoute, getRouteById } from "@/server/services/routes";

export const GET = route({ permission: "routes:read" }, ({ params }) => getRouteById(params.id));
export const DELETE = route({ permission: "routes:write" }, ({ user, params }) => deleteRoute(user, params.id));
