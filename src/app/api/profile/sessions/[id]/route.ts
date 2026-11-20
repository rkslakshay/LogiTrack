import { route } from "@/lib/api";
import { getSessionToken } from "@/lib/auth-server";
import { revokeSession } from "@/server/services/account";

export const DELETE = route({}, async ({ user, params }) => revokeSession(user, params.id, await getSessionToken()));
