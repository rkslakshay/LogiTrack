import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { APP_VERSION } from "@/lib/version";
import { logActivity } from "./activity";
import { clearSettingsCache } from "./settings";

/**
 * SQLite backup, verification and restore.
 *
 * Backup   `VACUUM INTO` asks SQLite itself to write a transaction-consistent copy of
 *          the live database. It is safe while the application is reading and writing:
 *          the file is never copied byte-for-byte while in use.
 * Verify   Every backup is opened with a separate connection and checked with
 *          `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and its tables are
 *          counted. A backup is only reported as created once it has passed.
 * Restore  The backup is attached to the live database and every table is replaced
 *          inside ONE transaction. Either everything is restored or nothing changes.
 *          A verified safety backup of the current data is always taken first.
 */

const log = logger("backup");

export const BACKUP_REASONS = ["manual", "scheduled", "pre-restore", "pre-migrate", "cli", "imported"] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

/** Only names produced by this module are ever accepted (no paths, no traversal). */
const NAME_PATTERN = new RegExp(`^logitrack-\\d{8}-\\d{6}(?:-\\d{1,3})?-(?:${BACKUP_REASONS.join("|")})\\.db$`);

/** Tables never restored from a backup: they hold credentials that must not come back to life. */
const CREDENTIAL_TABLES = ["Session", "AuthChallenge", "PasswordResetToken"];

/** Tables counted in manifests and shown in the UI. */
const COUNTED_TABLES = ["User", "Vehicle", "Driver", "Delivery", "DeliveryEvent", "FuelRecord", "MaintenanceRecord", "Notification", "ActivityLog"];

export interface BackupVerification {
  ok: boolean;
  integrity: string;
  foreignKeyViolations: number;
  migrations: string[];
  counts: Record<string, number>;
  checkedAt: string;
}

export interface BackupManifest {
  file: string;
  createdAt: string;
  reason: BackupReason;
  createdBy: { id: string; name: string } | null;
  sizeBytes: number;
  sha256: string;
  appVersion: string;
  latestMigration: string | null;
  verification: BackupVerification;
}

export interface BackupInfo {
  file: string;
  createdAt: string;
  reason: string;
  sizeBytes: number;
  createdBy: { id: string; name: string } | null;
  verified: boolean | null;
  verifiedAt: string | null;
  latestMigration: string | null;
  counts: Record<string, number> | null;
  sha256: string | null;
}

// --- Locations ----------------------------------------------------------------------

/** Absolute path of the live SQLite file, resolved the way Prisma resolves it (relative to prisma/). */
export function databasePath(url = process.env.DATABASE_URL ?? "file:./dev.db"): string {
  if (!url.startsWith("file:")) throw new Error("Backups are only supported for SQLite (file:) databases.");
  const raw = url.slice("file:".length).split("?")[0];
  return isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? resolve(raw) : resolve(process.cwd(), "prisma", raw);
}

/** Backups live next to the database unless BACKUP_DIR says otherwise. Never inside public/. */
export function backupDirectory(): string {
  // Runtime data paths: tell the bundler not to trace them (they are not part of the build output).
  return resolve(/* turbopackIgnore: true */ process.env.BACKUP_DIR || join(dirname(databasePath()), "backups"));
}

/** Validates a backup name and returns its absolute path inside the backup directory. */
export function backupPath(name: string): string {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) throw badRequest("Invalid backup name.");
  const dir = backupDirectory();
  const full = resolve(dir, name);
  if (!full.startsWith(dir + sep)) throw badRequest("Invalid backup name.");
  return full;
}

export function isValidBackupName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const sqliteUrl = (path: string, extra = "") => `file:${path.replace(/\\/g, "/")}${extra}`;
const toNumber = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((done, fail) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => done()).on("error", fail);
  });
  return hash.digest("hex");
}

/** Owner-only permissions where the platform supports them (no-op on Windows). */
async function restrict(path: string, mode: number) {
  try {
    await chmod(path, mode);
  } catch {
    /* best effort */
  }
}

// --- Checks -------------------------------------------------------------------------

async function inspect(client: PrismaClient): Promise<Omit<BackupVerification, "checkedAt">> {
  const integrityRows = await client.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
  const integrity = integrityRows.map((r) => r.integrity_check).join("; ") || "unknown";
  const fkRows = await client.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
  const tables = new Set(
    (await client.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name),
  );
  const migrations = tables.has("_prisma_migrations")
    ? (
        await client.$queryRawUnsafe<{ migration_name: string }[]>(
          "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
        )
      ).map((m) => m.migration_name)
    : [];
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    if (!tables.has(table)) continue;
    const rows = await client.$queryRawUnsafe<{ n: unknown }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
    counts[table] = toNumber(rows[0]?.n);
  }
  const ok = integrity === "ok" && fkRows.length === 0 && migrations.length > 0 && tables.has("User");
  return { ok, integrity, foreignKeyViolations: fkRows.length, migrations, counts };
}

/** Opens a SQLite file with its own connection and checks it. Never touches the live database. */
export async function verifyDatabaseFile(path: string): Promise<BackupVerification> {
  if (!(await exists(path))) throw notFound("Backup");
  const client = new PrismaClient({ datasourceUrl: sqliteUrl(path, "?connection_limit=1") });
  try {
    return { ...(await inspect(client)), checkedAt: new Date().toISOString() };
  } catch (err) {
    log.warn("verify.failed", { file: basename(path), err });
    return { ok: false, integrity: "unreadable", foreignKeyViolations: 0, migrations: [], counts: {}, checkedAt: new Date().toISOString() };
  } finally {
    await client.$disconnect();
  }
}

/** Integrity of the live database (diagnostics and the backup page). */
export async function checkLiveDatabase() {
  const started = Date.now();
  const result = await inspect(prisma);
  const [pages, freelist, pageSize, journal] = await Promise.all([
    prisma.$queryRawUnsafe<{ page_count: unknown }[]>("PRAGMA page_count"),
    prisma.$queryRawUnsafe<{ freelist_count: unknown }[]>("PRAGMA freelist_count"),
    prisma.$queryRawUnsafe<{ page_size: unknown }[]>("PRAGMA page_size"),
    prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode"),
  ]);
  const path = databasePath();
  const size = (await exists(path)) ? (await stat(path)).size : 0;
  const wal = (await exists(`${path}-wal`)) ? (await stat(`${path}-wal`)).size : 0;
  return {
    ...result,
    durationMs: Date.now() - started,
    file: basename(path),
    sizeBytes: size,
    walBytes: wal,
    pageCount: toNumber(pages[0]?.page_count),
    freePages: toNumber(freelist[0]?.freelist_count),
    pageSize: toNumber(pageSize[0]?.page_size),
    journalMode: journal[0]?.journal_mode ?? "unknown",
  };
}

// --- Backup -------------------------------------------------------------------------

async function manifestOf(file: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(`${file}.json`, "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}

/**
 * Creates a verified backup of the live database. The file only appears under its
 * final name once SQLite has written it completely and it has passed verification.
 */
export async function createBackup(opts: { reason?: BackupReason; actor?: Pick<SessionUser, "id" | "name"> | null } = {}): Promise<BackupManifest> {
  const reason = opts.reason ?? "manual";
  const dir = backupDirectory();
  await mkdir(dir, { recursive: true });
  await restrict(dir, 0o700);

  const now = new Date();
  let name = `logitrack-${stamp(now)}-${reason}.db`;
  for (let i = 1; (await exists(join(dir, name))) && i < 1000; i++) name = `logitrack-${stamp(now)}-${i}-${reason}.db`;
  const final = backupPath(name);
  const partial = `${final}.partial`;
  await rm(partial, { force: true });

  const started = Date.now();
  try {
    // SQLite writes a consistent snapshot; concurrent writers simply wait or continue on the WAL.
    await prisma.$executeRawUnsafe("VACUUM INTO ?", partial);
    const verification = await verifyDatabaseFile(partial);
    if (!verification.ok) {
      throw conflict(`The backup failed verification (${verification.integrity}, ${verification.foreignKeyViolations} foreign-key problems). It was discarded.`);
    }
    await rename(partial, final);
    await restrict(final, 0o600);
    const manifest: BackupManifest = {
      file: name,
      createdAt: now.toISOString(),
      reason,
      createdBy: opts.actor ? { id: opts.actor.id, name: opts.actor.name } : null,
      sizeBytes: (await stat(final)).size,
      sha256: await sha256(final),
      appVersion: APP_VERSION,
      latestMigration: verification.migrations.at(-1) ?? null,
      verification,
    };
    await writeFile(`${final}.json`, JSON.stringify(manifest, null, 2));
    await restrict(`${final}.json`, 0o600);
    log.info("backup.created", { file: name, reason, sizeBytes: manifest.sizeBytes, durationMs: Date.now() - started });
    return manifest;
  } catch (err) {
    await rm(partial, { force: true });
    log.error("backup.failed", { reason, err });
    throw err;
  }
}

/** Backups on disk, newest first, including ones made from the command line. */
export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupDirectory();
  if (!(await exists(dir))) return [];
  const names = (await readdir(/* turbopackIgnore: true */ dir)).filter((n) => NAME_PATTERN.test(n));
  const rows = await Promise.all(
    names.map(async (file): Promise<BackupInfo> => {
      const full = join(dir, file);
      const info = await stat(full);
      const manifest = await manifestOf(full);
      const reason = /-([a-z-]+)\.db$/.exec(file)?.[1] ?? "unknown";
      return {
        file,
        createdAt: manifest?.createdAt ?? info.mtime.toISOString(),
        reason,
        sizeBytes: info.size,
        createdBy: manifest?.createdBy ?? null,
        verified: manifest ? manifest.verification.ok : null,
        verifiedAt: manifest?.verification.checkedAt ?? null,
        latestMigration: manifest?.latestMigration ?? null,
        counts: manifest?.verification.counts ?? null,
        sha256: manifest?.sha256 ?? null,
      };
    }),
  );
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Re-checks a backup on demand and records the result in its manifest. */
export async function verifyBackup(name: string): Promise<BackupVerification & { sha256Matches: boolean | null }> {
  const path = backupPath(name);
  const verification = await verifyDatabaseFile(path);
  const manifest = await manifestOf(path);
  const digest = await sha256(path);
  if (manifest) {
    await writeFile(`${path}.json`, JSON.stringify({ ...manifest, verification }, null, 2));
  }
  return { ...verification, sha256Matches: manifest ? manifest.sha256 === digest : null };
}

export async function deleteBackup(name: string, actor: SessionUser) {
  const path = backupPath(name);
  if (!(await exists(path))) throw notFound("Backup");
  await rm(path, { force: true });
  await rm(`${path}.json`, { force: true });
  await logActivity(prisma, actor, "DELETE", "Backup", null, `Deleted backup ${name}`);
  log.info("backup.deleted", { file: name, userId: actor.id });
  return { file: name };
}

/** Keeps the newest `keep` scheduled backups; manual and safety backups are never pruned. */
export async function pruneScheduledBackups(keep: number) {
  const scheduled = (await listBackups()).filter((b) => b.reason === "scheduled");
  for (const old of scheduled.slice(Math.max(0, keep))) {
    const path = backupPath(old.file);
    await rm(path, { force: true });
    await rm(`${path}.json`, { force: true });
    log.info("backup.pruned", { file: old.file });
  }
}

/** Copies an external SQLite file into the backup directory (command line only) so it can be verified and restored. */
export async function importBackupFile(source: string): Promise<string> {
  const dir = backupDirectory();
  await mkdir(dir, { recursive: true });
  const name = `logitrack-${stamp(new Date())}-imported.db`;
  const target = backupPath(name);
  await copyFile(resolve(source), target);
  await restrict(target, 0o600);
  return name;
}

// --- Restore ------------------------------------------------------------------------

export interface RestoreResult {
  restoredFrom: string;
  safetyBackup: string;
  counts: Record<string, number>;
  durationMs: number;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Replaces all application data with the contents of a backup.
 *
 * Preconditions, all checked here: the backup passes verification, and it was made
 * with exactly the same database migrations as the running application. A verified
 * safety backup of the current data is taken before anything changes. Signed-in
 * sessions, login challenges and password-reset links are cleared rather than
 * restored, so everyone signs in again and no revoked credential comes back.
 */
export async function restoreBackup(name: string, actor: Pick<SessionUser, "id" | "name"> | null): Promise<RestoreResult> {
  const started = Date.now();
  const source = backupPath(name);
  const check = await verifyDatabaseFile(source);
  if (!check.ok) throw conflict(`This backup failed verification (${check.integrity}) and cannot be restored.`);

  const live = await inspect(prisma);
  const same = live.migrations.length === check.migrations.length && live.migrations.every((m, i) => m === check.migrations[i]);
  if (!same) {
    throw conflict(
      `This backup was made with a different database schema (backup: ${check.migrations.at(-1) ?? "none"}, current: ${live.migrations.at(-1) ?? "none"}). ` +
        "Restore it with the LogiTrack version that made it, then upgrade (migrations run on start-up): see docs/BACKUP_RESTORE.md.",
    );
  }

  const safety = await createBackup({ reason: "pre-restore", actor });
  log.warn("restore.started", { file: name, safetyBackup: safety.file, userId: actor?.id ?? null });

  // A dedicated single-connection client: ATTACH and PRAGMA are per-connection in SQLite.
  const client = new PrismaClient({ datasourceUrl: sqliteUrl(databasePath(), "?connection_limit=1&socket_timeout=30") });
  let attached = false;
  try {
    await client.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await client.$executeRawUnsafe("ATTACH DATABASE ? AS src", source);
    attached = true;
    const tables = (
      await client.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name",
      )
    ).map((t) => t.name);

    await client.$executeRawUnsafe("BEGIN IMMEDIATE");
    try {
      for (const table of tables) {
        await client.$executeRawUnsafe(`DELETE FROM main.${quote(table)}`);
        if (CREDENTIAL_TABLES.includes(table)) continue;
        const columns = (await client.$queryRawUnsafe<{ name: string }[]>(`PRAGMA main.table_info(${quote(table)})`)).map((c) => quote(c.name));
        const list = columns.join(", ");
        await client.$executeRawUnsafe(`INSERT INTO main.${quote(table)} (${list}) SELECT ${list} FROM src.${quote(table)}`);
      }
      const violations = await client.$queryRawUnsafe<unknown[]>("PRAGMA main.foreign_key_check");
      if (violations.length > 0) throw conflict(`The restored data has ${violations.length} foreign-key problems. Nothing was changed.`);
      await client.$executeRawUnsafe("COMMIT");
    } catch (err) {
      await client.$executeRawUnsafe("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } catch (err) {
    log.error("restore.failed", { file: name, err });
    throw err;
  } finally {
    if (attached) await client.$executeRawUnsafe("DETACH DATABASE src").catch(() => undefined);
    await client.$executeRawUnsafe("PRAGMA foreign_keys = ON").catch(() => undefined);
    await client.$disconnect();
  }

  clearSettingsCache();
  const after = await inspect(prisma);
  // The person who restored may not exist in the restored data; record the name either way.
  const actorExists = actor ? (await prisma.user.count({ where: { id: actor.id } })) > 0 : false;
  await logActivity(
    prisma,
    actorExists ? actor : null,
    "SYSTEM",
    "Backup",
    null,
    `${actor?.name ?? "Command line"} restored the database from ${name} (safety backup: ${safety.file})`,
  );
  const durationMs = Date.now() - started;
  log.warn("restore.completed", { file: name, durationMs, counts: after.counts });
  return { restoredFrom: name, safetyBackup: safety.file, counts: after.counts, durationMs };
}
