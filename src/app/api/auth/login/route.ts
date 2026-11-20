import { requestMeta, route } from "@/lib/api";
import { setChallengeCookie, setSessionCookie } from "@/lib/auth-server";
import { homeFor } from "@/lib/permissions";
import { loginSchema } from "@/lib/validation";
import { beginLogin } from "@/server/services/account";

/**
 * Step one of signing in. Accounts with two-factor authentication receive a
 * short-lived challenge cookie instead of a session and continue at /api/auth/mfa.
 */
export const POST = route({ auth: false, body: loginSchema }, async ({ req, body }) => {
  const outcome = await beginLogin(body.email, body.password, requestMeta(req));
  if (outcome.kind === "mfa") {
    await setChallengeCookie(outcome.challengeToken, outcome.expiresAt);
    return { mfaRequired: true };
  }
  await setSessionCookie(outcome.token, outcome.expiresAt);
  return { user: outcome.user, redirectTo: homeFor(outcome.user.role) };
});
