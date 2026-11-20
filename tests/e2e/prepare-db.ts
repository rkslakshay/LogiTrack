import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Builds a fresh, seeded database for the end-to-end run (prisma/e2e.db).
// DATABASE_URL is provided by playwright.config.ts; refuse to run against anything else.
if (process.env.DATABASE_URL !== "file:./e2e.db") {
  throw new Error("prepare-db.ts only runs against the e2e database (DATABASE_URL=file:./e2e.db).");
}
for (const suffix of ["", "-journal", "-wal", "-shm", ".server.lock"]) {
  rmSync(resolve(process.cwd(), "prisma", `e2e.db${suffix}`), { force: true });
}
// Backups made by earlier e2e runs (BACKUP_DIR=./prisma/e2e-backups) are throwaway too.
rmSync(resolve(process.cwd(), "prisma", "e2e-backups"), { recursive: true, force: true });
execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
