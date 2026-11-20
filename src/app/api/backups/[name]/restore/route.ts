import { route } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth-server";
import { logger } from "@/lib/logger";
import { getIo } from "@/lib/realtime";
import { restoreSchema } from "@/lib/validation";
import { reauthenticate } from "@/server/services/account";
import { backupPath, restoreBackup } from "@/server/services/backup";
import { getSimulator } from "@/server/simulator";

/**
 * Replaces all data with a backup. Requires typing RESTORE plus the administrator's
 * password (and code, with two-factor on). A safety backup is taken first. Everyone,
 * including the administrator, is signed out afterwards.
 */
export const POST = route({ permission: "system:backup", body: restoreSchema }, async ({ user, params, body }) => {
  backupPath(params.name);
  await reauthenticate(user, body);
  const simulator = getSimulator();
  const wasRunning = simulator.running;
  simulator.pause();
  try {
    const result = await restoreBackup(params.name, user);
    simulator.reset();
    // Sessions were cleared by the restore; drop live connections too.
    getIo()?.disconnectSockets(true);
    await clearSessionCookie();
    logger("backup").warn("restore.completed", { file: params.name, userId: user.id, durationMs: result.durationMs });
    return { ...result, signedOut: true };
  } finally {
    if (wasRunning) simulator.start();
  }
});
