import { route } from "@/lib/api";
import { maintenanceCompleteSchema } from "@/lib/validation";
import { completeMaintenance } from "@/server/services/maintenance";

export const POST = route({ permission: "maintenance:write", body: maintenanceCompleteSchema }, ({ user, params, body }) =>
  completeMaintenance(user, params.id, body),
);
