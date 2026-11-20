import { route } from "@/lib/api";
import { adminResetMfa } from "@/server/services/account";

/** Recovery: removes two-factor authentication from an account that lost its device and codes. */
export const DELETE = route({ permission: "users:manage" }, ({ user, params }) => adminResetMfa(user, params.id));
