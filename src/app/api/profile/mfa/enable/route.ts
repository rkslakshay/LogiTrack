import { route } from "@/lib/api";
import { getSessionToken } from "@/lib/auth-server";
import { mfaConfirmSchema } from "@/lib/validation";
import { confirmMfaSetup } from "@/server/services/account";

/** Confirms enrolment with a first code; returns the recovery codes once. */
export const POST = route({ body: mfaConfirmSchema }, async ({ user, body }) => confirmMfaSetup(user, body.code, await getSessionToken()));
