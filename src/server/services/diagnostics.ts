import { prisma } from "@/lib/db";
import { logCounts, recentProblems } from "@/lib/logger";
import { realtimeStatus } from "@/lib/realtime";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { isDemoMode } from "@/server/demo";
import { jobStatus } from "@/server/jobs";
import { getSimulator } from "@/server/simulator";
import { backupDirectory, checkLiveDatabase, listBackups } from "./backup";

const startedAt = new Date();

/**
 * Minimal liveness/readiness probe for container healthchecks and uptime monitors.
 * It is public, so it reveals nothing beyond "up or not" and the version.
 */
export async function health() {
  const started = Date.now();
  let database: "ok" | "unavailable" = "ok";
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    database = "unavailable";
  }
  return {
    status: database === "ok" ? ("ok" as const) : ("degraded" as const),
    version: APP_VERSION,
    database,
    responseMs: Date.now() - started,
  };
}

/** Full diagnostics for administrators. Contains no secrets and no personal data. */
export async function diagnostics() {
  const mem = process.memoryUsage();
  const [database, backups] = await Promise.all([
    checkLiveDatabase().catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })),
    listBackups().catch(() => []),
  ]);
  const simulator = getSimulator();
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      environment: process.env.NODE_ENV ?? "development",
      demoMode: isDemoMode(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal), externalMb: mb(mem.external) },
      logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info"),
    },
    database,
    realtime: realtimeStatus(),
    simulator: { ...simulator.state(), ...simulator.health() },
    jobs: jobStatus(),
    backups: {
      directory: backupDirectory(),
      count: backups.length,
      latest: backups[0] ? { file: backups[0].file, createdAt: backups[0].createdAt, reason: backups[0].reason } : null,
      scheduledEveryHours: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
    },
    logs: { counts: logCounts(), recent: recentProblems(50) },
    checkedAt: new Date().toISOString(),
  };
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
