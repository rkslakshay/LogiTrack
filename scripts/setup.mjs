// First-time (and repeatable) setup: `npm run setup`.
//
//   1. Refuses to run while a LogiTrack server from this folder is running: on Windows
//      a running server keeps Prisma's query-engine DLL loaded, and `prisma generate`
//      then fails with "EPERM: operation not permitted, rename ... .dll.node".
//   2. Generates the Prisma Client (downloads the engines if npm skipped Prisma's install
//      scripts). Transient network and file-lock errors are retried; anything else stops
//      the setup with an explanation. Nothing after this step runs if it fails.
//   3. Applies migrations (`prisma migrate deploy`): never deletes data.
//   4. Loads the demo data ONLY when the database has no users. Use `npm run db:seed`
//      to rebuild the demo data on purpose.
//
// Plain Node.js (no TypeScript, no Prisma import), so it works before the client exists.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const isWin = process.platform === "win32";
// Run the project's own CLIs through this Node binary: no shell, same on Windows, macOS and Linux.
const PRISMA = [resolve(cwd, "node_modules", "prisma", "build", "index.js")];
const TSX = [resolve(cwd, "node_modules", "tsx", "dist", "cli.mjs")];
const args = process.argv.slice(2);

const step = (n, text) => console.log(`\n[${n}/4] ${text}`);
const fail = (lines) => {
  console.error(["", "Setup stopped.", ...lines, ""].join("\n"));
  process.exit(1);
};

function run(cli, cmdArgs) {
  const r = spawnSync(process.execPath, [...cli, ...cmdArgs], { cwd, encoding: "utf8", env: process.env });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, output, stdout: r.stdout ?? "" };
}

/** Node processes running server.ts from this folder (best effort, never stops anything). */
function runningServers() {
  try {
    if (isWin) {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      return out.split(/\r?\n/).map((l) => l.split("\t")).filter(([pid, cmd]) => pid && cmd && cmd.toLowerCase().includes(cwd.toLowerCase()) && /server\.ts/.test(cmd) && Number(pid) !== process.pid)
        .map(([pid, cmd]) => ({ pid: Number(pid), cmd: cmd.trim() }));
    }
    const out = execFileSync("ps", ["-eo", "pid=,command="], { encoding: "utf8" });
    return out.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m && m[2].includes(cwd) && /server\.ts/.test(m[2]) && /node|tsx/.test(m[2]))
      .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
  } catch {
    return [];
  }
}

// --- 0. Preconditions -----------------------------------------------------------------
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) fail([`  LogiTrack needs Node.js 20.12 or newer (you have ${process.version}).`]);
if (!existsSync(resolve(cwd, "node_modules", "prisma"))) fail(["  Dependencies are not installed. Run:  npm install"]);
if (!existsSync(resolve(cwd, ".env")) && existsSync(resolve(cwd, ".env.example"))) {
  console.log("Note: no .env file. The defaults are used (copy .env.example to .env to change them).");
}

const servers = runningServers();
if (servers.length) {
  fail([
    "  A LogiTrack server from this folder is still running. It keeps Prisma's engine file open,",
    "  so the Prisma Client cannot be regenerated (Windows reports EPERM).",
    "",
    ...servers.map((s) => `    PID ${s.pid}: ${s.cmd.slice(0, 140)}`),
    "",
    "  Stop it with Ctrl+C in the terminal where it runs, or (PowerShell, after checking the PID above):",
    ...servers.map((s) => `    Stop-Process -Id ${s.pid}`),
    "  Then run  npm run setup  again. Only stop processes listed here: they are LogiTrack servers.",
  ]);
}

// --- 1. Prisma Client -------------------------------------------------------------------
step(1, "Generating the Prisma Client");
let generated = false;
for (let attempt = 1; attempt <= 3 && !generated; attempt++) {
  const r = run(PRISMA, ["generate"]);
  if (r.ok) {
    generated = true;
    console.log("      Prisma Client generated.");
    break;
  }
  const locked = /EPERM|EBUSY|operation not permitted/i.test(r.output);
  const network = /binaries\.prisma\.sh|ECONNRESET|ETIMEDOUT|ENOTFOUND|request to .* failed|fetch failed/i.test(r.output);
  if ((locked || network) && attempt < 3) {
    console.log(`      ${locked ? "Engine file is locked" : "Engine download failed"} (attempt ${attempt}/3); retrying in ${attempt * 3} s...`);
    await new Promise((r2) => setTimeout(r2, attempt * 3000));
    continue;
  }
  console.error(r.output.trim().split("\n").slice(-12).join("\n"));
  if (locked) {
    const now = runningServers();
    fail([
      "  Prisma could not replace node_modules\\.prisma\\client\\query_engine-*.node: the file is in use.",
      ...(now.length ? ["  These LogiTrack processes are running:", ...now.map((s) => `    PID ${s.pid}: ${s.cmd.slice(0, 140)}`)] : []),
      "  1. Stop every running LogiTrack server (npm run dev / npm start), Prisma Studio and test runs for this project.",
      "  2. Antivirus software can hold a freshly downloaded file for a few seconds: wait a moment.",
      "  3. Run  npm run setup  again.",
      "  Do not delete node_modules: once nothing holds the file, generation succeeds.",
    ]);
  }
  if (network) {
    fail([
      "  The Prisma engines could not be downloaded from binaries.prisma.sh (needed once, then cached).",
      "  Check your internet connection or proxy and run  npm run setup  again.",
    ]);
  }
  fail(["  prisma generate failed (output above)."]);
}

// --- 2. Migrations ------------------------------------------------------------------------
step(2, "Applying database migrations (existing data is kept)");
const migrate = run(PRISMA, ["migrate", "deploy"]);
if (!migrate.ok) {
  console.error(migrate.output.trim());
  fail([
    "  Migrations could not be applied. If the database is in use by a running server, stop it and retry.",
    "  Your data has not been changed by this step if it failed before applying anything; take a backup",
    "  (npm run db:backup) before trying again if you are unsure.",
  ]);
}
console.log(`      ${/No pending migrations/i.test(migrate.output) ? "Database already up to date." : "Migrations applied."}`);

// --- 3. Demo data (empty databases only) ----------------------------------------------
step(3, "Checking for existing data");
const count = run(TSX, ["scripts/db.ts", "count-users"]);
// stdout only (npm may print warnings on stderr); the count is the last line that is a number.
const users = Number(count.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).pop() ?? NaN);
if (!count.ok || Number.isNaN(users)) {
  console.error(count.output.trim());
  fail(["  Could not read the database after migrating."]);
}
const reseed = args.includes("--reseed");
step(4, users === 0 || reseed ? "Loading demo data" : "Keeping existing data");
if (users === 0 || reseed) {
  if (reseed && users > 0) console.log("      --reseed: rebuilding the demo data (existing records are replaced).");
  const seed = spawnSync(process.execPath, [...TSX, "prisma/seed.ts"], { cwd, stdio: "inherit", env: process.env });
  if (seed.status !== 0) fail(["  Loading the demo data failed (output above)."]);
} else {
  console.log(`      The database already has ${users} user account(s); demo data was NOT loaded.`);
  console.log("      To rebuild the demo data on purpose (replaces existing records):  npm run db:seed");
}

const envPort = process.env.PORT || (existsSync(".env") ? /^PORT=(\d+)/m.exec(readFileSync(".env", "utf8"))?.[1] : null) || "3000";
console.log(`\nSetup complete. Start LogiTrack with:  npm run dev   (then open http://localhost:${envPort})`);
console.log("If that port is busy (PowerShell):  $env:PORT=3001; npm run dev\n");
