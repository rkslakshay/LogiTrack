import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { databasePath } from "@/lib/db-path";
import { acquireInstanceLock, instanceLockedMessage, isPortFree, pidFromNetstat, portInUseMessage, releaseInstanceLock } from "@/server/startup";

const lockFile = () => `${databasePath()}.server.lock`;

describe("port checks", () => {
  it("reports a port as busy while something listens on it, and free afterwards", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortFree(port)).toBe(true);
  });

  it("finds the listening process in Windows netstat output (IPv4 and IPv6)", () => {
    const out = [
      "Active Connections",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234",
      "  TCP    127.0.0.1:30001        127.0.0.1:52000        ESTABLISHED     999",
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       35536",
    ].join("\r\n");
    expect(pidFromNetstat(out, 3000)).toBe(35536);
    expect(pidFromNetstat(out, 300)).toBeNull(); // no partial-port matches
    expect(pidFromNetstat(out, 30001)).toBeNull(); // established connections are not listeners
    expect(pidFromNetstat("  TCP    [::]:3001              [::]:0                 LISTENING       4242", 3001)).toBe(4242);
  });

  it("explains a port conflict with the owner and safe next steps, without stopping anything", () => {
    const other = portInUseMessage(3000, { pid: 4242, command: "node next start -p 3000", isLogiTrack: false });
    expect(other).toContain("port 3000 is already in use");
    expect(other).toContain("PID 4242");
    expect(other).toContain("different program");
    expect(other).toContain("$env:PORT=3001; npm run dev");
    expect(other).toContain("Get-NetTCPConnection -LocalPort 3000 -State Listen");
    expect(other).not.toContain("Stop-Process");

    const stale = portInUseMessage(3000, { pid: 77, command: "node server.ts", isLogiTrack: true });
    expect(stale).toContain("another LogiTrack server");
    expect(stale).toContain("Stop-Process -Id 77");

    expect(portInUseMessage(3000, null)).toContain("$env:PORT=3001; npm run dev");
  });
});

describe("one server per database", () => {
  afterEach(() => releaseInstanceLock());

  it("claims the database with this process's PID and port, and releases it", () => {
    expect(acquireInstanceLock(3100)).toEqual({ ok: true });
    const lock = JSON.parse(readFileSync(lockFile(), "utf8"));
    expect(lock).toMatchObject({ pid: process.pid, port: 3100 });
    releaseInstanceLock();
    expect(existsSync(lockFile())).toBe(false);
  });

  it("replaces a lock left behind by a process that no longer exists", () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: 2_147_483_000, port: 3000, startedAt: "2026-01-01T00:00:00.000Z" }));
    expect(acquireInstanceLock(3001)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).pid).toBe(process.pid);
  });

  it("does not release a lock that belongs to another process", () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: 2_147_483_000, port: 3000, startedAt: "x" }));
    releaseInstanceLock();
    expect(existsSync(lockFile())).toBe(true);
    writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, port: 3000, startedAt: "x" }));
  });

  it("names the running server in the refusal message", () => {
    const msg = instanceLockedMessage({ pid: 99, port: 3001, startedAt: "2026-11-19T10:00:00.000Z" }, "E:/x/dev.db");
    expect(msg).toContain("PID 99, port 3001");
    expect(msg).toContain("http://localhost:3001");
    expect(msg).toContain("simulator");
  });
});
