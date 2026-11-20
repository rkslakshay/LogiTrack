import { route } from "@/lib/api";
import { cancelMaintenance } from "@/server/services/maintenance";

export const POST = route({ permission: "maintenance:write" }, ({ user, params }) => cancelMaintenance(user, params.id));
