import { requestMeta, route } from "@/lib/api";
import { passwordResetSchema } from "@/lib/validation";
import { resetPasswordWithToken } from "@/server/services/account";

/** Sets a new password with a one-time reset link (public; the link is the credential). */
export const POST = route({ auth: false, body: passwordResetSchema }, ({ req, body }) =>
  resetPasswordWithToken(body.token, body.newPassword, requestMeta(req)),
);
