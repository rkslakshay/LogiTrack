import { route } from "@/lib/api";
import { statusChangeSchema } from "@/lib/validation";
import { changeDeliveryStatus, getDelivery } from "@/server/services/deliveries";

// Staff may update any delivery; drivers only their own (enforced in the service).
export const POST = route({ permission: ["deliveries:status", "deliveries:own"], body: statusChangeSchema }, async ({ user, params, body }) => {
  await changeDeliveryStatus(user, params.id, body);
  return getDelivery(user, params.id);
});
