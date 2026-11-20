import { route } from "@/lib/api";
import { getSessionToken } from "@/lib/auth-server";
import { changePasswordSchema } from "@/lib/validation";
import { changePassword } from "@/server/services/users";

export const POST = route({ body: changePasswordSchema }, async ({ user, body }) => changePassword(user, body, await getSessionToken()));
