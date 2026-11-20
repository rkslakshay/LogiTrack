import { route } from "@/lib/api";
import { mfaSetupSchema } from "@/lib/validation";
import { mfaStatus, startMfaSetup } from "@/server/services/account";

/** Status only: never the secret. */
export const GET = route({}, ({ user }) => mfaStatus(user));

/** Starts enrolment (password required). The response is the only place the new secret appears. */
export const POST = route({ body: mfaSetupSchema }, ({ user, body }) => startMfaSetup(user, body.password));
