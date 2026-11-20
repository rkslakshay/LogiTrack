import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";
import { renderSVG } from "uqr";
import {
  createSession, destroyUserSessions, hashPassword, hashToken, verifyPassword, verifyPasswordOrDummy, type SessionUser,
} from "@/lib/auth";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { passwordProblems } from "@/lib/password-policy";
import { LIMITS } from "@/lib/rate-limit";
import { logActivity } from "./activity";

/**
 * Account security: sign-in (with lockout and two-factor), TOTP enrolment,
 * recovery codes, administrator-issued password reset links, re-authentication
 * for sensitive actions, and session management.
 *
 * Nothing here ever returns a password hash, a TOTP secret (except to the user
 * themself during enrolment, before it is active) or a recovery-code hash.
 */

const log = logger("auth");

export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_MINUTES = 15;
const CHALLENGE_MINUTES = 5;
const CHALLENGE_MAX_ATTEMPTS = 5;
const RESET_LINK_MINUTES = 60;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_BCRYPT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 8;
const ISSUER = "LogiTrack";

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

const tooMany = (retryAfterMs: number) =>
  new ApiError(429, `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} minute(s).`, "RATE_LIMITED", undefined, {
    "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
  });

/** Rejects a password that breaks the policy, with field-level messages. */
export function assertStrongPassword(password: string, context: { email?: string | null; name?: string | null }, field = "password") {
  const problems = passwordProblems(password, context);
  if (problems.length) throw badRequest(problems[0], { [field]: problems[0] });
}

// --- TOTP --------------------------------------------------------------------------

function totpFor(secretBase32: string, label: string) {
  return new TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

/** Returns the matched time step, or null. Accepts the previous and next step for clock drift. */
function matchTotp(secretBase32: string, code: string, now = Date.now()): number | null {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return null;
  const delta = totpFor(secretBase32, "x").validate({ token, window: 1, timestamp: now });
  return delta === null ? null : Math.floor(now / 1000 / 30) + delta;
}

const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

function generateRecoveryCodes(): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomToken(10);
    let code = "";
    for (let i = 0; i < 10; i++) code += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

async function storeRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(normaliseRecoveryCode(c), RECOVERY_BCRYPT_ROUNDS)));
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
  ]);
  return codes;
}

/** Consumes a recovery code if it matches an unused one. */
async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const value = normaliseRecoveryCode(code);
  if (value.length !== 10) return false;
  const unused = await prisma.mfaRecoveryCode.findMany({ where: { userId, usedAt: null } });
  for (const row of unused) {
    if (await bcrypt.compare(value, row.codeHash)) {
      const marked = await prisma.mfaRecoveryCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      return marked.count === 1;
    }
  }
  return false;
}

/** Verifies a TOTP code with replay protection (each time step works once). */
async function consumeTotp(user: { id: string; mfaSecret: string | null; mfaLastStep: number | null }, code: string): Promise<boolean> {
  if (!user.mfaSecret) return false;
  let secret: string;
  try {
    secret = decrypt(user.mfaSecret);
  } catch (err) {
    log.error("mfa.secret_unreadable", { userId: user.id, err });
    return false;
  }
  const step = matchTotp(secret, code);
  if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) return false;
  // Guarded write: two requests with the same code cannot both succeed.
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
    data: { mfaLastStep: step },
  });
  return claimed.count === 1;
}

// --- Sign-in -------------------------------------------------------------------------

export type LoginOutcome =
  | { kind: "session"; token: string; expiresAt: Date; user: { id: string; name: string; email: string; role: string; driverId: string | null } }
  | { kind: "mfa"; challengeToken: string; expiresAt: Date };

async function recordFailure(user: { id: string; failedLoginCount: number }, meta: RequestMeta, reason: string) {
  const count = user.failedLoginCount + 1;
  const lock = count >= LOCKOUT_THRESHOLD;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: count, ...(lock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : {}) },
  });
  log.warn(lock ? "login.locked" : "login.failed", { userId: user.id, reason, failures: count, ip: meta.ip });
}

/**
 * Step one of a sign-in. Every failure looks the same from outside (same status,
 * same message, a bcrypt comparison either way), so the endpoint does not reveal
 * which e-mail addresses have accounts.
 */
export async function beginLogin(email: string, password: string, meta: RequestMeta): Promise<LoginOutcome> {
  const byAddress = LIMITS.loginPerAddress().hit(meta.ip);
  if (!byAddress.allowed) {
    log.warn("login.rate_limited", { ip: meta.ip });
    throw tooMany(byAddress.retryAfterMs);
  }
  const unknownLimiter = LIMITS.loginUnknownAccount();
  const blockedUnknown = unknownLimiter.peek(email);
  if (!blockedUnknown.allowed) throw tooMany(blockedUnknown.retryAfterMs);

  const user = await prisma.user.findUnique({ where: { email }, include: { driver: { select: { id: true } } } });
  const now = Date.now();
  if (user?.lockedUntil && user.lockedUntil.getTime() > now) {
    // Checked before the password so a locked account cannot be probed.
    await verifyPasswordOrDummy(password, null);
    throw tooMany(user.lockedUntil.getTime() - now);
  }

  const valid = await verifyPasswordOrDummy(password, user?.passwordHash);
  if (!user) {
    unknownLimiter.hit(email);
    log.warn("login.failed", { reason: "unknown_account", ip: meta.ip });
    throw new ApiError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }
  if (!valid) {
    await recordFailure(user, meta, "wrong_password");
    throw new ApiError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }
  if (!user.isActive) {
    log.warn("login.denied", { userId: user.id, reason: "inactive" });
    throw new ApiError(403, "This account has been deactivated. Contact your administrator.", "ACCOUNT_DISABLED");
  }

  if (user.mfaEnabled && user.mfaSecret) {
    const challengeToken = randomToken();
    const expiresAt = new Date(now + CHALLENGE_MINUTES * 60_000);
    await prisma.authChallenge.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date(now) } }] } });
    await prisma.authChallenge.create({ data: { tokenHash: hashToken(challengeToken), userId: user.id, expiresAt } });
    log.info("login.mfa_required", { userId: user.id });
    return { kind: "mfa", challengeToken, expiresAt };
  }
  return completeLogin(user, meta, "password");
}

async function completeLogin(
  user: { id: string; name: string; email: string; role: string; driver: { id: string } | null },
  meta: RequestMeta,
  method: string,
): Promise<LoginOutcome> {
  const session = await createSession(user.id, meta.userAgent);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  await logActivity(prisma, user, "LOGIN", "User", user.id, `${user.name} signed in${method === "password" ? "" : ` (${method})`}`);
  log.info("login.succeeded", { userId: user.id, role: user.role, method });
  return {
    kind: "session",
    token: session.token,
    expiresAt: session.expiresAt,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, driverId: user.driver?.id ?? null },
  };
}

/** Step two: exchange the challenge and a TOTP or recovery code for a real session. */
export async function completeMfaLogin(challengeToken: string | null, input: { code?: string | null; recoveryCode?: string | null }, meta: RequestMeta): Promise<LoginOutcome> {
  if (!challengeToken) throw unauthorized("Your sign-in expired. Please enter your password again.");
  const challenge = await prisma.authChallenge.findUnique({ where: { tokenHash: hashToken(challengeToken) } });
  if (!challenge || challenge.expiresAt.getTime() < Date.now() || challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
    if (challenge) await prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw unauthorized("Your sign-in expired. Please enter your password again.");
  }
  const perUser = LIMITS.mfaPerUser().hit(challenge.userId);
  if (!perUser.allowed) throw tooMany(perUser.retryAfterMs);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: challenge.userId }, include: { driver: { select: { id: true } } } });
  if (!user.isActive) throw new ApiError(403, "This account has been deactivated. Contact your administrator.", "ACCOUNT_DISABLED");

  const ok = input.recoveryCode ? await consumeRecoveryCode(user.id, input.recoveryCode) : input.code ? await consumeTotp(user, input.code) : false;
  if (!ok) {
    await prisma.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    await recordFailure(user, meta, input.recoveryCode ? "wrong_recovery_code" : "wrong_totp");
    const field = input.recoveryCode ? "recoveryCode" : "code";
    throw new ApiError(401, "That code is not valid. Check your authenticator app and try again.", "INVALID_CODE", { [field]: "Invalid code" });
  }
  await prisma.authChallenge.delete({ where: { id: challenge.id } });
  if (input.recoveryCode) {
    const left = await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
    log.warn("mfa.recovery_code_used", { userId: user.id, remaining: left });
  }
  return completeLogin(user, meta, input.recoveryCode ? "recovery code" : "two-factor");
}

// --- Enrolment -----------------------------------------------------------------------

export async function mfaStatus(user: SessionUser) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaEnabled: true, mfaEnabledAt: true } });
  const remaining = row.mfaEnabled ? await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } }) : 0;
  return { enabled: row.mfaEnabled, enabledAt: row.mfaEnabledAt, recoveryCodesRemaining: remaining };
}

/** Re-checks the password (and a second factor when enabled) before a sensitive action. */
export async function reauthenticate(user: Pick<SessionUser, "id">, input: { password?: string | null; code?: string | null; recoveryCode?: string | null }) {
  const limit = LIMITS.reauthPerUser().hit(user.id);
  if (!limit.allowed) throw tooMany(limit.retryAfterMs);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!input.password || !(await verifyPassword(input.password, row.passwordHash))) {
    log.warn("reauth.failed", { userId: user.id, reason: "password" });
    throw new ApiError(401, "Your password is incorrect.", "REAUTH_FAILED", { password: "Incorrect password" });
  }
  if (row.mfaEnabled) {
    const ok = input.recoveryCode ? await consumeRecoveryCode(row.id, input.recoveryCode) : input.code ? await consumeTotp(row, input.code) : false;
    if (!ok) {
      log.warn("reauth.failed", { userId: user.id, reason: "second_factor" });
      throw new ApiError(401, "Enter a valid code from your authenticator app.", "REAUTH_FAILED", { code: "Invalid code" });
    }
  }
  return row;
}

/**
 * Starts enrolment: a new secret is generated and kept as *pending* until the user
 * proves they can generate codes from it. This is the only response that ever
 * contains a TOTP secret, and only to its owner, with no-store caching.
 */
export async function startMfaSetup(user: SessionUser, password: string) {
  const row = await reauthenticate(user, { password });
  if (row.mfaEnabled) throw conflict("Two-factor authentication is already on. Turn it off first to enrol a new device.");
  const secret = new Secret({ size: 20 }).base32;
  await prisma.user.update({ where: { id: user.id }, data: { mfaPendingSecret: encrypt(secret) } });
  const uri = totpFor(secret, row.email).toString();
  log.info("mfa.setup_started", { userId: user.id });
  return { otpauthUri: uri, manualKey: secret.match(/.{1,4}/g)!.join(" "), qrSvg: renderSVG(uri, { border: 2 }), issuer: ISSUER, account: row.email };
}

/** Finishes enrolment with a first valid code and returns recovery codes (shown once). */
export async function confirmMfaSetup(user: SessionUser, code: string, currentToken: string | null) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (row.mfaEnabled) throw conflict("Two-factor authentication is already on.");
  if (!row.mfaPendingSecret) throw badRequest("Start the set-up again: no pending authenticator was found.");
  const step = matchTotp(decrypt(row.mfaPendingSecret), code);
  if (step === null) throw new ApiError(400, "That code did not match. Make sure the time on your phone is correct.", "INVALID_CODE", { code: "Invalid code" });
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true, mfaSecret: row.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step },
  });
  const recoveryCodes = await storeRecoveryCodes(user.id);
  // Other devices signed in with the password alone are signed out.
  await destroyUserSessions(user.id, currentToken);
  await logActivity(prisma, user, "UPDATE", "User", user.id, `${user.name} turned on two-factor authentication`);
  log.info("mfa.enabled", { userId: user.id });
  return { recoveryCodes };
}

export async function disableMfa(user: SessionUser, input: { password: string; code?: string | null; recoveryCode?: string | null }) {
  const row = await reauthenticate(user, input);
  if (!row.mfaEnabled) throw conflict("Two-factor authentication is not on.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  await logActivity(prisma, user, "UPDATE", "User", user.id, `${user.name} turned off two-factor authentication`);
  log.warn("mfa.disabled", { userId: user.id, by: "self" });
  return { enabled: false };
}

export async function regenerateRecoveryCodes(user: SessionUser, input: { password: string; code?: string | null }) {
  const row = await reauthenticate(user, input);
  if (!row.mfaEnabled) throw conflict("Two-factor authentication is not on.");
  const recoveryCodes = await storeRecoveryCodes(user.id);
  await logActivity(prisma, user, "UPDATE", "User", user.id, `${user.name} generated new recovery codes`);
  log.info("mfa.recovery_codes_regenerated", { userId: user.id });
  return { recoveryCodes };
}

/** Recovery path when a user has lost both their device and their codes: a Super Admin removes two-factor. */
export async function adminResetMfa(actor: SessionUser, userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  if (!target.mfaEnabled) throw conflict("Two-factor authentication is not on for this user.");
  if (userId === actor.id) throw forbidden("Turn off your own two-factor authentication from Settings.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  await destroyUserSessions(userId);
  await logActivity(prisma, actor, "UPDATE", "User", userId, `Removed two-factor authentication for ${target.name}`);
  log.warn("mfa.disabled", { userId, by: actor.id });
  return { id: userId, mfaEnabled: false };
}

// --- Password reset (no e-mail required) ---------------------------------------------

/**
 * Creates a one-time reset link. The administrator gives it to the user directly
 * (in person, by phone or chat). Only the SHA-256 of the token is stored; the link
 * is shown once and expires after an hour.
 */
export async function createPasswordResetLink(actor: Pick<SessionUser, "id" | "name"> | null, userId: string, origin: string) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  if (!target.isActive) throw conflict("Reactivate this account before creating a reset link.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + RESET_LINK_MINUTES * 60_000);
  await prisma.$transaction([
    // Only the newest link works.
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId, expiresAt, createdById: actor?.id ?? null } }),
  ]);
  const actorExists = actor ? (await prisma.user.count({ where: { id: actor.id } })) > 0 : false;
  await logActivity(prisma, actorExists ? actor : null, "UPDATE", "User", userId, `${actor?.name ?? "Command line"} created a password reset link for ${target.name}`);
  log.info("password_reset.link_created", { userId, by: actor?.id ?? "cli" });
  // The token travels in the URL fragment, which browsers never send to a server.
  return { url: `${origin.replace(/\/$/, "")}/reset-password#token=${token}`, expiresAt, user: { id: target.id, name: target.name } };
}

/** Sets a new password with a reset link. Signs out every session and clears any lockout. */
export async function resetPasswordWithToken(token: string, newPassword: string, meta: RequestMeta) {
  const limit = LIMITS.resetPerAddress().hit(meta.ip);
  if (!limit.allowed) throw tooMany(limit.retryAfterMs);
  const invalid = () => new ApiError(400, "This reset link is invalid or has expired. Ask your administrator for a new one.", "INVALID_TOKEN");
  if (!/^[a-f0-9]{64}$/.test(token)) throw invalid();
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now() || !row.user.isActive) {
    log.warn("password_reset.rejected", { ip: meta.ip, reason: !row ? "unknown" : row.usedAt ? "used" : "expired" });
    throw invalid();
  }
  assertStrongPassword(newPassword, { email: row.user.email, name: row.user.name }, "newPassword");
  if (await verifyPassword(newPassword, row.user.passwordHash)) {
    throw badRequest("Choose a password you have not used for this account.", { newPassword: "Same as the current password" });
  }
  // Single use: only one request can flip usedAt.
  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalid();
  await prisma.user.update({
    where: { id: row.userId },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  await destroyUserSessions(row.userId);
  await logActivity(prisma, { id: row.userId }, "UPDATE", "User", row.userId, `${row.user.name} reset their password with a reset link`);
  log.info("password_reset.completed", { userId: row.userId });
  return { ok: true, mfaEnabled: row.user.mfaEnabled };
}

export async function unlockAccount(actor: SessionUser | null, userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
  await logActivity(prisma, actor, "UPDATE", "User", userId, `Unlocked the account of ${target.name}`);
  log.info("account.unlocked", { userId, by: actor?.id ?? "cli" });
  return { id: userId };
}

// --- Sessions ------------------------------------------------------------------------

export async function listSessions(user: SessionUser, currentToken: string | null) {
  const current = currentToken ? hashToken(currentToken) : null;
  const rows = await prisma.session.findMany({
    where: { userId: user.id },
    select: { id: true, tokenHash: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
  // The token hash identifies the current session but is never sent to the client.
  return rows.map(({ tokenHash, ...s }) => ({ ...s, current: tokenHash === current }));
}

export async function revokeSession(user: SessionUser, sessionId: string, currentToken: string | null) {
  const row = await prisma.session.findFirst({ where: { id: sessionId, userId: user.id } });
  if (!row) throw notFound("Session");
  if (currentToken && row.tokenHash === hashToken(currentToken)) throw badRequest("Use Sign out to end the session you are using.");
  await prisma.session.delete({ where: { id: row.id } });
  log.info("session.revoked", { userId: user.id });
  return { id: sessionId };
}

export async function revokeOtherSessions(user: SessionUser, currentToken: string | null) {
  const before = await prisma.session.count({ where: { userId: user.id } });
  await destroyUserSessions(user.id, currentToken);
  const after = await prisma.session.count({ where: { userId: user.id } });
  await logActivity(prisma, user, "UPDATE", "User", user.id, `${user.name} signed out of ${before - after} other session(s)`);
  return { signedOut: before - after };
}

/** Purges expired sessions, challenges and reset links (background job). */
export async function purgeExpiredCredentials() {
  const now = new Date();
  const idleCutoff = new Date(Date.now() - Number(process.env.SESSION_IDLE_MINUTES || 720) * 60_000);
  const [sessions, challenges, resets] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { lastSeenAt: { lt: idleCutoff } }] } }),
    prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
  ]);
  return { sessions: sessions.count, challenges: challenges.count, resetLinks: resets.count };
}

/** Command-line recovery: removes two-factor without an acting administrator. */
export async function adminResetMfaByEmail(email: string) {
  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) throw notFound("User");
  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: target.id } }),
  ]);
  await destroyUserSessions(target.id);
  await logActivity(prisma, null, "UPDATE", "User", target.id, `Two-factor authentication removed for ${target.name} from the command line`);
  log.warn("mfa.disabled", { userId: target.id, by: "cli" });
}
