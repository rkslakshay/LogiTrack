import { parseListQuery, route } from "@/lib/api";
import { routeCreateSchema } from "@/lib/validation";
import { createRoute, listRoutes } from "@/server/services/routes";

export const GET = route({ permission: "routes:read" }, ({ query }) => listRoutes(parseListQuery(query), { status: query.get("status") }));
export const POST = route({ permission: "routes:write", body: routeCreateSchema }, ({ user, body }) => createRoute(user, body));
