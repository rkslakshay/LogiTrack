import { route } from "@/lib/api";
import { runReminderSweep } from "@/server/services/reminders";

/** Runs the reminder engine on demand (it also runs automatically every 5 minutes). */
export const POST = route({ permission: "maintenance:write" }, () => runReminderSweep());
