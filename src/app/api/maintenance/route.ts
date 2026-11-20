import { parseListQuery, route } from "@/lib/api";
import { maintenanceSchema } from "@/lib/validation";
import { createMaintenance, listMaintenance } from "@/server/services/maintenance";

export const GET = route({ permission: "maintenance:read" }, ({ query }) =>
  listMaintenance(parseListQuery(query), { vehicleId: query.get("vehicleId"), status: query.get("status"), type: query.get("type") }),
);
export const POST = route({ permission: "maintenance:write", body: maintenanceSchema }, ({ user, body }) => createMaintenance(user, body));
