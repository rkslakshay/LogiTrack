import { route } from "@/lib/api";
import { startMaintenance } from "@/server/services/maintenance";

export const POST = route({ permission: "maintenance:write" }, ({ user, params }) => startMaintenance(user, params.id));
