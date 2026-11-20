import { route } from "@/lib/api";
import { reauthSchema } from "@/lib/validation";
import { disableMfa } from "@/server/services/account";

export const POST = route({ body: reauthSchema }, ({ user, body }) => disableMfa(user, body));
