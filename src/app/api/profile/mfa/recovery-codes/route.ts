import { route } from "@/lib/api";
import { reauthSchema } from "@/lib/validation";
import { regenerateRecoveryCodes } from "@/server/services/account";

/** Replaces all recovery codes (password and a current code required). */
export const POST = route({ body: reauthSchema }, ({ user, body }) => regenerateRecoveryCodes(user, body));
