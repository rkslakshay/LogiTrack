import { route } from "@/lib/api";
import { routePreviewSchema } from "@/lib/validation";
import { previewRoute } from "@/server/services/routes";

/** Optimises the stop order for the selected deliveries without saving anything. */
export const POST = route({ permission: "routes:read", body: routePreviewSchema }, ({ body }) => previewRoute(body));
