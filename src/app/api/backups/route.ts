import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { tooMany } from "@/lib/errors";
import { logActivity } from "@/server/services/activity";
import { backupDirectory, createBackup, listBackups } from "@/server/services/backup";

/** Backups on disk, newest first. Super Admin only. */
export const GET = route({ permission: "system:backup" }, async () => ({
  directory: backupDirectory(),
  scheduledEveryHours: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
  keepScheduled: Math.max(1, Number(process.env.BACKUP_KEEP ?? 7)),
  backups: await listBackups(),
}));

/** Creates a verified backup now. */
export const POST = route({ permission: "system:backup" }, async ({ user }) => {
  const limit = LIMITS.backupsPerUser().hit(user.id);
  if (!limit.allowed) throw tooMany(limit.retryAfterMs);
  const backup = await createBackup({ reason: "manual", actor: user });
  await logActivity(prisma, user, "SYSTEM", "Backup", null, `Created backup ${backup.file}`);
  return backup;
});
