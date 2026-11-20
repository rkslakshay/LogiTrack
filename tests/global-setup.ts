import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Gives the test run its own throwaway SQLite database (prisma/test.db):
 * the previous file is removed and the migrations are applied to a new one.
 * The development database (dev.db) is never touched.
 */
export default function setup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(resolve(process.cwd(), "prisma", `test.db${suffix}`), { force: true });
  }
  rmSync(resolve(process.cwd(), "prisma", "test-backups"), { recursive: true, force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
