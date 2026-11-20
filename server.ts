import "./src/server/env";
import { createServer } from "node:http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { getUserByToken, isSessionValid, onSessionsRevoked, parseCookie, sessionCookieName } from "./src/lib/auth";
import { prisma } from "./src/lib/db";
import { logger } from "./src/lib/logger";
import { realtimeStats, setIo, STAFF_ROOM, userRoom, EVENTS } from "./src/lib/realtime";
import { APP_VERSION } from "./src/lib/version";
import { isDemoMode } from "./src/server/demo";
import { scheduleJob, stopAllJobs } from "./src/server/jobs";
import { getSimulator } from "./src/server/simulator";
import { purgeExpiredCredentials } from "./src/server/services/account";
import { createBackup, pruneScheduledBackups } from "./src/server/services/backup";
import { runReminderSweep } from "./src/server/services/reminders";
import { databasePath } from "./src/lib/db-path";
import { acquireInstanceLock, describePortOwner, instanceLockedMessage, isPortFree, portInUseMessage, releaseInstanceLock } from "./src/server/startup";

const log = logger("server");
const socketLog = logger("realtime");

// Single process hosting three things on one port:
//   1. the Next.js app (pages + REST API)
//   2. the Socket.IO realtime channel
//   3. background jobs: GPS simulator and the reminder sweep

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME_BIND || "localhost";
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`LogiTrack could not start: PORT must be a number between 1 and 65535 (got "${process.env.PORT}").`);
  process.exit(1);
}

/** A websocket handshake is only accepted from the app's own origin. */
function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  // Non-browser clients send no Origin header; they still need a valid session cookie.
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Listens and resolves once listening; rejects (instead of throwing an uncaught error) when it cannot. */
function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function main() {
  // 1. Fail fast, before anything is started: is the port free, and is this database already served?
  // Probe the wildcard address as well: on Windows a localhost-only bind can succeed while another
  // program holds the port on all interfaces, which would silently split traffic between the two.
  if (!(await isPortFree(port)) || !(await isPortFree(port, hostname))) {
    console.error(portInUseMessage(port, describePortOwner(port)));
    process.exit(1);
  }
  const lock = acquireInstanceLock(port);
  if (!lock.ok) {
    console.error(instanceLockedMessage(lock.holder, databasePath()));
    process.exit(1);
  }

  const httpServer = createServer();
  const app = next({ dev, hostname, port, httpServer });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  httpServer.on("request", (req, res) => {
    if (req.url?.startsWith("/socket.io")) return; // handled by Socket.IO
    // Trusted client address for rate limiting; a client-supplied value is discarded.
    req.headers["x-logitrack-client-ip"] = req.socket.remoteAddress ?? "unknown";
    void handle(req, res);
  });

  const io = new IOServer(httpServer, {
    path: "/socket.io",
    // Let Next.js keep its own (HMR) websocket upgrades.
    destroyUpgrade: false,
    serveClient: false,
    // WebSockets are not covered by the browser's CORS checks, so a page on another site could
    // otherwise try to open one. Reject any handshake that does not come from our own origin.
    allowRequest: (req, callback) => {
      const ok = sameOrigin(req.headers.origin, req.headers["x-forwarded-host"]?.toString() ?? req.headers.host);
      if (!ok) {
        realtimeStats.rejectedHandshakes++;
        socketLog.warn("socket.cross_origin_refused", { origin: req.headers.origin });
      }
      callback(ok ? null : "Cross-origin connection refused", ok);
    },
  });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/socket.io")) void upgrade(req, socket, head);
  });

  // Every socket must present a valid session cookie.
  io.use(async (socket, nextFn) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie, sessionCookieName());
      const user = await getUserByToken(token);
      if (!user) {
        realtimeStats.rejectedHandshakes++;
        return nextFn(new Error("unauthorized"));
      }
      socket.data.user = user;
      socket.data.token = token;
      nextFn();
    } catch (err) {
      realtimeStats.rejectedHandshakes++;
      socketLog.error("socket.auth_failed", { err });
      nextFn(new Error("unauthorized"));
    }
  });

  const simulator = getSimulator();
  io.on("connection", (socket) => {
    const user = socket.data.user as { id: string; role: string };
    realtimeStats.totalConnections++;
    realtimeStats.lastConnectionAt = new Date().toISOString();
    socketLog.debug("socket.connected", { userId: user.id, role: user.role, connected: io.of("/").sockets.size });
    socket.on("disconnect", (reason) => socketLog.debug("socket.disconnected", { userId: user.id, reason, connected: io.of("/").sockets.size }));
    void socket.join(userRoom(user.id));
    // Fleet-wide feeds are for staff; drivers only receive events addressed to them.
    if (user.role !== "DRIVER") {
      void socket.join(STAFF_ROOM);
      socket.emit(EVENTS.simulator, simulator.state());
    }
  });
  setIo(io);

  // A socket outlives the HTTP request that authenticated it, so revocation has to reach it:
  //  - immediately, when sessions are destroyed (logout, deactivation, password or role change)
  //  - within a minute in every other case (expiry), via a periodic re-check.
  const dropInvalid = async (userId?: string) => {
    const sockets = userId ? await io.in(userRoom(userId)).fetchSockets() : await io.fetchSockets();
    for (const s of sockets) {
      if (!(await isSessionValid(s.data.token as string | undefined))) {
        realtimeStats.revokedDisconnects++;
        s.disconnect(true);
      }
    }
  };
  onSessionsRevoked((userId) => void dropInvalid(userId).catch((err: unknown) => socketLog.error("socket.revoke_failed", { err })));
  setInterval(() => void dropInvalid().catch((err: unknown) => socketLog.error("socket.revoke_failed", { err })), 60_000).unref();

  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;").catch(() => undefined);

  if (isDemoMode()) {
    // Demo environments only advance trips while someone is connected, so the sample
    // deliveries are still on the road when a demonstration starts.
    simulator.setGate(() => io.of("/").sockets.size > 0);
  }
  // 2. Listen. Only once the port is ours do the simulator and the background jobs start,
  //    so a failed start-up never leaves them running (or holding the database) in the background.
  try {
    await listen(httpServer);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EADDRINUSE") console.error(portInUseMessage(port, describePortOwner(port)));
    else if (e.code === "EACCES") console.error(`
LogiTrack could not start: no permission to listen on port ${port}. Try a port above 1024, e.g. $env:PORT=3001; npm run dev
`);
    else log.error("server.listen_failed", { err });
    io.close();
    releaseInstanceLock();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }

  if (process.env.SIMULATOR_AUTOSTART !== "false") simulator.start();

  // Background jobs (status visible on the diagnostics page; failures are logged, never fatal).
  scheduleJob("reminders", "Maintenance, insurance and licence reminders", 5 * 60_000, () => runReminderSweep(), 3000);
  scheduleJob("credential-cleanup", "Remove expired sessions, sign-in challenges and reset links", 60 * 60_000, () => purgeExpiredCredentials(), 60_000);
  const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  if (backupHours > 0) {
    const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 7));
    scheduleJob("scheduled-backup", `Verified database backup every ${backupHours} h (keeps the latest ${keep})`, backupHours * 3_600_000, async () => {
      const backup = await createBackup({ reason: "scheduled" });
      const removed = await pruneScheduledBackups(keep);
      return { file: backup.file, sizeBytes: backup.sizeBytes, pruned: removed };
    }, 10 * 60_000);
  }

  const shownHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  log.info("server.ready", {
    url: `http://${shownHost}:${port}`, version: APP_VERSION, mode: dev ? "development" : "production", demo: isDemoMode(),
    simulator: simulator.running ? "running" : "paused",
  });
  console.log(`
  LogiTrack ${APP_VERSION} is running. Open http://${shownHost}:${port}
`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("server.stopping", { signal });
    simulator.pause();
    stopAllJobs();
    io.close();
    releaseInstanceLock();
    // Stop accepting connections; give in-flight requests a moment to finish.
    httpServer.close();
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (err) => log.error("process.unhandled_rejection", { err }));
  process.on("exit", () => releaseInstanceLock());
}

main().catch((err) => {
  log.error("server.start_failed", { err });
  stopAllJobs();
  getSimulator().pause();
  releaseInstanceLock();
  process.exit(1);
});
