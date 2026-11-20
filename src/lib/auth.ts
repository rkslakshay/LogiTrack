import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Role } from "./constants";

// Framework-independent authentication primitives (no next/headers here so the
// module is usable from the Socket.IO server and from tests).

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  /** Set when the account is linked to a Driver profile. */
  driverId: string | null;
}

const BCRYPT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 10;

/**
 * Session policy:
 *  - absolute lifetime SESSION_TTL_DAYS (default 7 days), never extended
 *  - idle timeout SESSION_IDLE_MINUTES (default 12 hours without a request)
 *  - at most MAX_SESSIONS_PER_USER live sessions; the oldest are signed out first
 */
const sessionTtlMs = () => Number(process.env.SESSION_TTL_DAYS || 7) * 86_400_000;
const sessionIdleMs = () => Number(process.env.SESSION_IDLE_MINUTES || 720) * 60_000;
export const MAX_SESSIONS_PER_USER = 10;
/** lastSeenAt is written at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Cookie names. Over HTTPS the `__Host-` prefix makes browsers insist on Secure,
 * Path=/ and no Domain attribute, so a sibling subdomain cannot plant the cookie.
 */
export const secureCookies = () => process.env.COOKIE_SECURE === "true";
export const sessionCookieName = () => (secureCookies() ? "__Host-lt_session" : "lt_session");
export const challengeCookieName = () => (secureCookies() ? "__Host-lt_mfa" : "lt_mfa");

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// A real hash of a random value. Comparing against it when the account does not exist
// makes "unknown email" take as long as "wrong password", so response time reveals nothing.
let dummyHash: Promise<string> | null = null;
export async function verifyPasswordOrDummy(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (hash) return bcrypt.compare(plain, hash);
  dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}

/** Only same-site relative paths are accepted as post-login redirects. */
export function safeRedirectPath(next: string | null | undefined): string | null {
  if (!next) return null;
  // Must start with a single "/" followed by a normal path character: rejects "//host", "/\\host" and absolute URLs.
  if (!/^\/[A-Za-z0-9_\-]/.test(next)) return null;
  if (next.includes("\\") || next.includes("//") || /[\u0000-\u001f]/.test(next)) return null;
  return next;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Creates a server-side session. The browser only ever receives the random
 * token; the database stores its SHA-256 so a leaked DB cannot be replayed.
 */
export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, userAgent: userAgent?.slice(0, 250) ?? null, expiresAt },
  });
  // Cap concurrent sessions: sign out the oldest beyond the limit.
  const extra = await prisma.session.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: MAX_SESSIONS_PER_USER, select: { id: true } });
  if (extra.length) await prisma.session.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
  return { token, expiresAt };
}

export async function getUserByToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length !== 64) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { driver: { select: { id: true } } } } },
  });
  if (!session) return null;
  const now = Date.now();
  const idle = now - session.lastSeenAt.getTime() > sessionIdleMs();
  if (session.expiresAt.getTime() < now || idle || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role as Role, driverId: u.driver?.id ?? null };
}

// Realtime sockets are authenticated once, at connection time. When sessions are revoked the
// socket layer is told so it can drop connections that no longer have a valid session.
type RevocationListener = (userId: string) => void;
const globalAuth = globalThis as unknown as { __logitrackRevocation?: RevocationListener };
export function onSessionsRevoked(listener: RevocationListener) {
  globalAuth.__logitrackRevocation = listener;
}
const announceRevocation = (userId: string) => {
  try {
    globalAuth.__logitrackRevocation?.(userId);
  } catch {
    /* the socket layer is optional (tests, scripts) */
  }
};

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  const sessions = await prisma.session.findMany({ where: { tokenHash: hashToken(token) }, select: { userId: true } });
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  for (const s of sessions) announceRevocation(s.userId);
}

export async function destroyUserSessions(userId: string, exceptToken?: string | null) {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptToken ? { NOT: { tokenHash: hashToken(exceptToken) } } : {}) },
  });
  announceRevocation(userId);
}

/** True while the token still maps to a live session of an active user. */
export async function isSessionValid(token: string | undefined | null): Promise<boolean> {
  return (await getUserByToken(token)) !== null;
}

export function parseCookie(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// --- Login throttling (in-memory, per email+ip) --------------------------------

const attempts = new Map<string, { count: number; first: number; max: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;

export function loginThrottled(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= entry.max;
}

/** `max` is the number of failures tolerated inside the window for this key. */
export function recordLoginFailure(key: string, max: number = MAX_ATTEMPTS) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now(), max });
  else entry.count++;
  // Bound memory: forget the oldest keys if someone sprays many different emails.
  if (attempts.size > 5000) for (const k of [...attempts.keys()].slice(0, 1000)) attempts.delete(k);
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
