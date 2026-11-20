import { route } from "@/lib/api";
import { maintenanceSchema } from "@/lib/validation";
import { deleteMaintenance, updateMaintenance } from "@/server/services/maintenance";

export const PUT = route({ permission: "maintenance:write", body: maintenanceSchema }, ({ user, params, body }) => updateMaintenance(user, params.id, body));
export const DELETE = route({ permission: "maintenance:write" }, ({ user, params }) => deleteMaintenance(user, params.id));
