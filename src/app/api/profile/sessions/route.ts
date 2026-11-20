import { route } from "@/lib/api";
import { getSessionToken } from "@/lib/auth-server";
import { listSessions, revokeOtherSessions } from "@/server/services/account";

export const GET = route({}, async ({ user }) => listSessions(user, await getSessionToken()));

/** Signs out every session except the one making the request. */
export const DELETE = route({}, async ({ user }) => revokeOtherSessions(user, await getSessionToken()));
