import { readFile } from "node:fs/promises";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { reauthSchema } from "@/lib/validation";
import { reauthenticate } from "@/server/services/account";
import { logActivity } from "@/server/services/activity";
import { backupPath, deleteBackup } from "@/server/services/backup";

/**
 * Downloads a backup file. A backup contains every account's password hash and all
 * operational data, so this is Super Admin only, never cached, and always logged.
 */
export const GET = route({ permission: "system:backup" }, async ({ user, params }) => {
  const path = backupPath(params.name);
  const data = await readFile(path).catch(() => {
    throw notFound("Backup");
  });
  await logActivity(prisma, user, "EXPORT", "Backup", null, `Downloaded backup ${params.name}`);
  logger("backup").warn("backup.downloaded", { file: params.name, userId: user.id });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${params.name}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
});

/** Deletes a backup. Requires the administrator's password (and code, with two-factor on). */
export const DELETE = route({ permission: "system:backup", body: reauthSchema }, async ({ user, params, body }) => {
  backupPath(params.name);
  await reauthenticate(user, body);
  return deleteBackup(params.name, user);
});
