import { route } from "@/lib/api";
import { deliverySchema } from "@/lib/validation";
import { deleteDelivery, getDelivery, updateDelivery } from "@/server/services/deliveries";

export const GET = route({ permission: ["deliveries:read", "deliveries:own"] }, ({ user, params }) => getDelivery(user, params.id));
export const PUT = route({ permission: "deliveries:write", body: deliverySchema }, ({ user, params, body }) => updateDelivery(user, params.id, body));
export const DELETE = route({ permission: "deliveries:write" }, ({ user, params }) => deleteDelivery(user, params.id));
