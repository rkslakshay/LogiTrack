import "../src/server/env";
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { prisma } from "../src/lib/db";
import {
  backupDirectory, checkLiveDatabase, createBackup, databasePath, importBackupFile, isValidBackupName, listBackups, restoreBackup, verifyBackup,
} from "../src/server/services/backup";

// Command-line database maintenance. See docs/BACKUP_RESTORE.md.
//
//   npm run db:backup                     create a verified backup
//   npm run db:backups                    list backups
//   npm run db:verify -- <file>           re-verify a backup
//   npm run db:check                      integrity check of the live database
//   npm run db:restore -- <file|path>     restore (asks you to type RESTORE; --yes skips the prompt)

const [command, arg, ...flags] = process.argv.slice(2);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function confirm(question: string, expected: string): Promise<boolean> {
  if (flags.includes("--yes") || process.argv.includes("--yes")) return true;
  if (!process.stdin.isTTY) {
    console.error("Refusing to restore without confirmation. Re-run in a terminal, or pass --yes.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer === expected;
}

async function main() {
  if (command !== "count-users") {
    console.log(`Database: ${databasePath()}`);
    console.log(`Backups:  ${backupDirectory()}\n`);
  }

  switch (command) {
    case "backup": {
      const m = await createBackup({ reason: arg === "pre-migrate" ? "pre-migrate" : "cli" });
      console.log(`Created and verified ${m.file} (${kb(m.sizeBytes)}, sha256 ${m.sha256.slice(0, 12)}…)`);
      console.log(`Counts: ${Object.entries(m.verification.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      break;
    }
    case "list": {
      const rows = await listBackups();
      if (rows.length === 0) console.log("No backups yet.");
      for (const b of rows) {
        const status = b.verified === true ? "verified" : b.verified === false ? "FAILED" : "unverified";
        console.log(`${b.file.padEnd(48)} ${kb(b.sizeBytes).padStart(9)}  ${status.padEnd(10)} ${b.createdAt}`);
      }
      break;
    }
    case "verify": {
      if (!arg) throw new Error("Usage: npm run db:verify -- <backup file name>");
      const v = await verifyBackup(arg);
      console.log(`${arg}: ${v.ok ? "OK" : "FAILED"}`);
      console.log(`  integrity: ${v.integrity}, foreign-key problems: ${v.foreignKeyViolations}, checksum ${v.sha256Matches === null ? "not recorded" : v.sha256Matches ? "matches" : "DOES NOT MATCH"}`);
      console.log(`  latest migration: ${v.migrations.at(-1) ?? "none"}`);
      if (!v.ok || v.sha256Matches === false) process.exitCode = 1;
      break;
    }
    case "check": {
      const r = await checkLiveDatabase();
      console.log(`Integrity: ${r.integrity}; foreign-key problems: ${r.foreignKeyViolations}; journal: ${r.journalMode}`);
      console.log(`Size: ${kb(r.sizeBytes)} (+${kb(r.walBytes)} WAL), ${r.pageCount} pages, ${r.freePages} free; checked in ${r.durationMs} ms`);
      console.log(`Rows: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case "restore": {
      if (!arg) throw new Error("Usage: npm run db:restore -- <backup file name or path to a .db file>");
      const name = isValidBackupName(arg) ? arg : existsSync(arg) ? await importBackupFile(arg) : null;
      if (!name) throw new Error(`Not a backup name or an existing file: ${arg}`);
      const v = await verifyBackup(name);
      if (!v.ok) throw new Error(`${name} failed verification (${v.integrity}). Nothing was changed.`);
      console.log(`About to replace ALL current data with ${name}:`);
      console.log(`  ${Object.entries(v.counts).map(([k, n]) => `${k} ${n}`).join(", ")}`);
      console.log("A safety backup of the current data is taken first. Everyone will need to sign in again.");
      console.log("Stop the application server before restoring if you can.\n");
      if (!(await confirm('Type RESTORE to continue: ', "RESTORE"))) {
        console.log("Cancelled. Nothing was changed.");
        return;
      }
      const r = await restoreBackup(name, null);
      console.log(`Restored from ${r.restoredFrom} in ${r.durationMs} ms. Safety backup: ${r.safetyBackup}`);
      break;
    }
    case "count-users": {
      // Used by the Docker entrypoint to decide whether the database is empty.
      console.log(String(await prisma.user.count()));
      break;
    }
    default:
      console.log("Commands: backup | list | verify <file> | check | restore <file|path> [--yes]");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
