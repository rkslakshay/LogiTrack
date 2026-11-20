import { route } from "@/lib/api";
import { pointRouteSchema } from "@/lib/validation";
import { pointToPoint } from "@/server/services/routes";

/** Distance / time estimate between two points. */
export const POST = route({ permission: ["routes:read", "deliveries:write"], body: pointRouteSchema }, ({ body }) =>
  pointToPoint([body.from.lat, body.from.lng], [body.to.lat, body.to.lng]),
);
