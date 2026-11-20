import { route } from "@/lib/api";
import { assignSchema } from "@/lib/validation";
import { assignRoute } from "@/server/services/routes";

export const POST = route({ permission: "routes:write", body: assignSchema }, ({ user, params, body }) => assignRoute(user, params.id, body));
