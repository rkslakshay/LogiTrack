/** Pure reminder rules for maintenance and document expiry. */

export type ReminderState = "OVERDUE" | "DUE_SOON" | "OK";

export interface MaintenanceLike {
  status: string;
  serviceDate: Date | string;
  nextServiceDate: Date | string | null;
  nextServiceOdometer: number | null;
}

export interface ReminderResult {
  state: ReminderState;
  reason: string | null;
  /** The date the reminder refers to, when date-based. */
  dueDate: Date | null;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) => Math.round((+startOfDay(a) - +startOfDay(b)) / DAY);

/**
 * - A SCHEDULED / IN_PROGRESS job is due on its service date.
 * - A COMPLETED job creates a follow-up reminder from its next service date and/or
 *   next service odometer (whichever comes first). Only pass the LATEST completed
 *   record per vehicle and maintenance type, otherwise old follow-ups resurface.
 */
export function maintenanceReminder(
  record: MaintenanceLike,
  vehicleOdometer: number,
  opts: { now?: Date; days: number; km: number },
): ReminderResult {
  const now = opts.now ?? new Date();
  const ok: ReminderResult = { state: "OK", reason: null, dueDate: null };

  // Cancelled jobs need nothing; a job that is IN_PROGRESS is already being handled.
  if (record.status === "CANCELLED" || record.status === "IN_PROGRESS") return ok;

  if (record.status === "SCHEDULED") {
    const due = new Date(record.serviceDate);
    const diff = dayDiff(due, now);
    if (diff < 0) return { state: "OVERDUE", reason: `Service was due ${-diff} day${diff === -1 ? "" : "s"} ago`, dueDate: due };
    if (diff <= opts.days) {
      return { state: "DUE_SOON", reason: diff === 0 ? "Service is due today" : `Service due in ${diff} day${diff === 1 ? "" : "s"}`, dueDate: due };
    }
    return { ...ok, dueDate: due };
  }

  // COMPLETED: follow-up service.
  let result: ReminderResult = ok;
  if (record.nextServiceDate) {
    const due = new Date(record.nextServiceDate);
    const diff = dayDiff(due, now);
    if (diff < 0) result = { state: "OVERDUE", reason: `Next service was due ${-diff} day${diff === -1 ? "" : "s"} ago`, dueDate: due };
    else if (diff <= opts.days) {
      result = { state: "DUE_SOON", reason: diff === 0 ? "Next service is due today" : `Next service due in ${diff} day${diff === 1 ? "" : "s"}`, dueDate: due };
    } else result = { ...ok, dueDate: due };
  }
  if (record.nextServiceOdometer != null && result.state !== "OVERDUE") {
    const remaining = record.nextServiceOdometer - vehicleOdometer;
    if (remaining <= 0) {
      result = { state: "OVERDUE", reason: `Service odometer exceeded by ${Math.abs(remaining).toLocaleString("en-IN")} km`, dueDate: result.dueDate };
    } else if (remaining <= opts.km && result.state === "OK") {
      result = { state: "DUE_SOON", reason: `Next service in ${remaining.toLocaleString("en-IN")} km`, dueDate: result.dueDate };
    }
  }
  return result;
}

/** Insurance / registration / licence expiry. */
export function expiryReminder(expiry: Date | string, opts: { now?: Date; days: number }): { state: ReminderState; days: number } {
  const diff = dayDiff(new Date(expiry), opts.now ?? new Date());
  if (diff < 0) return { state: "OVERDUE", days: diff };
  if (diff <= opts.days) return { state: "DUE_SOON", days: diff };
  return { state: "OK", days: diff };
}
