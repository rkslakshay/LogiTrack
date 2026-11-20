import { route } from "@/lib/api";
import { createPasswordResetLink } from "@/server/services/account";

/** Creates a one-time password reset link for the administrator to hand to the user. */
export const POST = route({ permission: "users:manage" }, ({ req, user, params }) => createPasswordResetLink(user, params.id, req.nextUrl.origin));
