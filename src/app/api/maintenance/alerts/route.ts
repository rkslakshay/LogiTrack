import { route } from "@/lib/api";
import { complianceAlerts, maintenanceAlerts } from "@/server/services/maintenance";

export const GET = route({ permission: "maintenance:read" }, async () => {
  const [maintenance, compliance] = await Promise.all([maintenanceAlerts(), complianceAlerts()]);
  return { maintenance, compliance };
});
