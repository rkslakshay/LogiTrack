import { requestMeta, route } from "@/lib/api";
import { clearChallengeCookie, getChallengeToken, setSessionCookie } from "@/lib/auth-server";
import { homeFor } from "@/lib/permissions";
import { mfaVerifySchema } from "@/lib/validation";
import { completeMfaLogin } from "@/server/services/account";

/** Step two of signing in: a code from the authenticator app, or a recovery code. */
export const POST = route({ auth: false, body: mfaVerifySchema }, async ({ req, body }) => {
  const outcome = await completeMfaLogin(await getChallengeToken(), body, requestMeta(req));
  if (outcome.kind !== "session") throw new Error("Unexpected sign-in state");
  await clearChallengeCookie();
  await setSessionCookie(outcome.token, outcome.expiresAt);
  return { user: outcome.user, redirectTo: homeFor(outcome.user.role) };
});
