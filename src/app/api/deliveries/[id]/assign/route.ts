import { route } from "@/lib/api";
import { assignSchema } from "@/lib/validation";
import { assignDelivery, unassignDelivery } from "@/server/services/deliveries";

export const POST = route({ permission: "deliveries:write", body: assignSchema }, ({ user, params, body }) => assignDelivery(user, params.id, body));
export const DELETE = route({ permission: "deliveries:write" }, ({ user, params }) => unassignDelivery(user, params.id));
