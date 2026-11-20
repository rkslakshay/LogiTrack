import { parseListQuery, route } from "@/lib/api";
import { userCreateSchema } from "@/lib/validation";
import { createUser, listUsers } from "@/server/services/users";

export const GET = route({ permission: "users:manage" }, ({ query }) => listUsers(parseListQuery(query), { role: query.get("role"), active: query.get("active") }));
export const POST = route({ permission: "users:manage", body: userCreateSchema }, ({ user, body }) => createUser(user, body));
