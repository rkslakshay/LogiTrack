import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { databasePath } from "@/lib/db-path";

/**
 * Start-up safety checks for server.ts:
 *  - is the port free? If not, who holds it (best effort, never kills anything)?
 *  - is another LogiTrack server already running against the same database?
 *    Two servers on one database would run two simulators and duplicate jobs.
 */

export interface PortOwner {
  pid: number;
  command: string | null;
  /** True when the command line looks like a LogiTrack server from this folder. */
  isLogiTrack: boolean;
}

/** Resolves true when nothing is listening on host:port. */
export function isPortFree(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

function commandLineOf(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: "utf8", timeout: 15_000, windowsHide: true },
      ).trim();
      return out || null;
    }
    if (existsSync(`/proc/${pid}/cmdline`)) return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim() || null;
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

const looksLikeLogiTrack = (command: string | null) =>
  !!command && command.toLowerCase().includes(process.cwd().toLowerCase()) && /server\.ts/.test(command);

/** Finds the listening PID in `netstat -ano` output (Windows). Exported for tests. */
export function pidFromNetstat(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    // "  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    35536"  /  "  TCP    [::]:3000   [::]:0   LISTENING   35536"
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "TCP" || cols[3] !== "LISTENING") continue;
    if (cols[1].endsWith(`:${port}`)) return Number(cols[4]) || null;
  }
  return null;
}

/** Which process listens on the port (Windows: netstat; elsewhere: lsof). Null when unknown. */
export function describePortOwner(port: number): PortOwner | null {
  let pid: number | null = null;
  try {
    if (process.platform === "win32") {
      // netstat answers instantly; Get-NetTCPConnection can take several seconds to load.
      pid = pidFromNetstat(execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", timeout: 10_000, windowsHide: true }), port);
      if (!pid) pid = pidFromNetstat(execFileSync("netstat", ["-ano", "-p", "TCPv6"], { encoding: "utf8", timeout: 10_000, windowsHide: true }), port);
    } else {
      const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 5000 }).trim();
      pid = Number(out.split("\n")[0]) || null;
    }
  } catch {
    return null;
  }
  if (!pid) return null;
  const command = commandLineOf(pid);
  return { pid, command, isLogiTrack: looksLikeLogiTrack(command) };
}

/** A clear, actionable message for a port that is already taken. Nothing is stopped automatically. */
export function portInUseMessage(port: number, owner: PortOwner | null): string {
  const lines = [``, `LogiTrack could not start: port ${port} is already in use.`, ``];
  if (owner) {
    const cmd = owner.command ? owner.command.replace(/\s+/g, " ").slice(0, 160) : "(command line unavailable)";
    lines.push(`  Listening process: PID ${owner.pid}`, `  Command: ${cmd}`, ``);
    lines.push(
      owner.isLogiTrack
        ? `  This looks like another LogiTrack server from this folder. If it is working, just open http://localhost:${port}.\n  If it is a stale instance you no longer need, stop it (PowerShell):  Stop-Process -Id ${owner.pid}`
        : `  This is a different program. Leave it running and start LogiTrack on another port.`,
      ``,
    );
  }
  lines.push(
    `  Start LogiTrack on another port:`,
    `    PowerShell:   $env:PORT=3001; npm run dev`,
    `    cmd.exe:      set PORT=3001 && npm run dev`,
    `    macOS/Linux:  PORT=3001 npm run dev`,
    `  (or set PORT=3001 in .env)`,
    ``,
    `  Find out what is using the port (PowerShell):`,
    `    Get-NetTCPConnection -LocalPort ${port} -State Listen`,
    `    Get-Process -Id <OwningProcess>`,
    ``,
  );
  return lines.join("\n");
}

// --- One server per database --------------------------------------------------------

interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
}

/** One lock per database file (dev.db.server.lock, e2e.db.server.lock, ...), next to it. */
const lockFile = () => `${databasePath()}.server.lock`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claims the database for this server process. Returns the other server's details when
 * a live LogiTrack server already holds it. A lock left by a crashed process is replaced.
 */
export function acquireInstanceLock(port: number): { ok: true } | { ok: false; holder: LockInfo } {
  const file = lockFile();
  if (existsSync(file)) {
    try {
      const holder = JSON.parse(readFileSync(file, "utf8")) as LockInfo;
      if (holder.pid !== process.pid && alive(holder.pid) && looksLikeLogiTrack(commandLineOf(holder.pid) ?? "server.ts " + process.cwd())) {
        return { ok: false, holder };
      }
    } catch {
      /* unreadable lock: treat as stale */
    }
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() } satisfies LockInfo));
  return { ok: true };
}

export function releaseInstanceLock() {
  try {
    const file = lockFile();
    if (!existsSync(file)) return;
    const holder = JSON.parse(readFileSync(file, "utf8")) as LockInfo;
    if (holder.pid === process.pid) rmSync(file, { force: true });
  } catch {
    /* best effort */
  }
}

export function instanceLockedMessage(holder: LockInfo, database: string): string {
  return [
    ``,
    `LogiTrack could not start: another LogiTrack server is already running against this database.`,
    `  Database: ${database}`,
    `  Running server: PID ${holder.pid}, port ${holder.port}, started ${holder.startedAt}`,
    ``,
    `  Use it at http://localhost:${holder.port}, or stop it first (PowerShell):  Stop-Process -Id ${holder.pid}`,
    `  Two servers on one database would run the GPS simulator and background jobs twice.`,
    `  To run a second, separate instance, give it its own database: $env:DATABASE_URL="file:./other.db"; $env:PORT=3001; npm run dev`,
    ``,
  ].join("\n");
}
