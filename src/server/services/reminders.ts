import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { flagOverdueDeliveries } from "./deliveries";
import { complianceAlerts, maintenanceAlerts } from "./maintenance";
import { FLEET_ROLES, notifyRoles } from "./notifications";

const KIND_LABEL = { INSURANCE: "Insurance", REGISTRATION: "Registration", LICENSE: "Driving licence" } as const;

/**
 * Periodic sweep that turns time-based conditions into persisted notifications:
 * maintenance due/overdue, insurance/registration/licence expiry and overdue
 * deliveries. Safe to run repeatedly: every reminder carries a dedupe key, so a
 * given condition notifies each user exactly once.
 */
export async function runReminderSweep(now = new Date()) {
  let created = 0;

  for (const alert of await maintenanceAlerts(now)) {
    created += await notifyRoles(prisma, FLEET_ROLES, {
      category: "MAINTENANCE",
      severity: alert.state === "OVERDUE" ? "CRITICAL" : "WARNING",
      title: alert.state === "OVERDUE" ? "Maintenance overdue" : "Maintenance due soon",
      message: `${alert.typeLabel} for ${alert.registrationNumber}: ${alert.reason}.`,
      entityType: "MaintenanceRecord",
      entityId: alert.recordId,
      dedupeKey: `maintenance:${alert.recordId}:${alert.state}`,
    });
  }

  for (const alert of await complianceAlerts(now)) {
    const expired = alert.state === "OVERDUE";
    const when = expired
      ? `expired on ${format(alert.expiry, "dd MMM yyyy")}`
      : alert.days === 0
        ? "expires today"
        : `expires in ${alert.days} day${alert.days === 1 ? "" : "s"} (${format(alert.expiry, "dd MMM yyyy")})`;
    created += await notifyRoles(
      prisma,
      FLEET_ROLES,
      {
        category: "COMPLIANCE",
        severity: expired ? "CRITICAL" : "WARNING",
        title: `${KIND_LABEL[alert.kind]} ${expired ? "expired" : "expiring soon"}`,
        message: `${KIND_LABEL[alert.kind]} for ${alert.subject} ${when}.`,
        entityType: alert.entityType,
        entityId: alert.entityId,
        dedupeKey: `${alert.kind.toLowerCase()}:${alert.entityId}:${format(alert.expiry, "yyyy-MM-dd")}:${alert.state}`,
      },
      alert.kind === "LICENSE" ? [alert.userId] : [],
    );
  }

  const delayed = await flagOverdueDeliveries(now);
  return { notificationsCreated: created, deliveriesFlaggedDelayed: delayed };
}
