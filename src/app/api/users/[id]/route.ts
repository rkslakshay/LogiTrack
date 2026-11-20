import { route } from "@/lib/api";
import { userUpdateSchema } from "@/lib/validation";
import { deactivateUser, updateUser } from "@/server/services/users";

export const PUT = route({ permission: "users:manage", body: userUpdateSchema }, ({ user, params, body }) => updateUser(user, params.id, body));
export const DELETE = route({ permission: "users:manage" }, ({ user, params }) => deactivateUser(user, params.id));
