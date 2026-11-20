import { parseListQuery, route } from "@/lib/api";
import { deliverySchema } from "@/lib/validation";
import { createDelivery, listDeliveries } from "@/server/services/deliveries";

// Drivers reach this endpoint too; the service scopes them to their own deliveries.
export const GET = route({ permission: ["deliveries:read", "deliveries:own"] }, ({ user, query }) =>
  listDeliveries(user, parseListQuery(query), {
    status: query.get("status"),
    priority: query.get("priority"),
    driverId: query.get("driverId"),
    vehicleId: query.get("vehicleId"),
    scope: query.get("scope"),
  }),
);

export const POST = route({ permission: "deliveries:write", body: deliverySchema }, ({ user, body }) => createDelivery(user, body));
