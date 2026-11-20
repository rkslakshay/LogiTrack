import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import { createSession, getUserByToken, hashPassword, MAX_SESSIONS_PER_USER, type SessionUser } from "@/lib/auth";
import { resetAllLimiters } from "@/lib/rate-limit";
import {
  adminResetMfa, beginLogin, completeMfaLogin, confirmMfaSetup, createPasswordResetLink, disableMfa, LOCKOUT_THRESHOLD, mfaStatus, purgeExpiredCredentials,
  reauthenticate, resetPasswordWithToken, startMfaSetup, unlockAccount,
} from "@/server/services/account";
import { listUsers } from "@/server/services/users";
import { makeUser, prisma, resetDb } from "../helpers";

const meta = { ip: "203.0.113.7", userAgent: "vitest" };
const PASSWORD = "Convoy-Pune-77";
let seq = 0;

async function account(role: "SUPER_ADMIN" | "DISPATCHER" = "DISPATCHER"): Promise<SessionUser & { password: string }> {
  seq++;
  const user = await prisma.user.create({
    data: { name: `Member ${seq}`, email: `member${seq}@sec.test`, role, passwordHash: await hashPassword(PASSWORD) },
  });
  return { id: user.id, name: user.name, email: user.email, phone: null, role, driverId: null, password: PASSWORD };
}

const codeFor = (manualKey: string, steps = 0) =>
  new TOTP({ secret: Secret.fromBase32(manualKey.replace(/ /g, "")) }).generate({ timestamp: Date.now() + steps * 30_000 });

async function enrol(user: SessionUser) {
  const setup = await startMfaSetup(user, PASSWORD);
  const { recoveryCodes } = await confirmMfaSetup(user, codeFor(setup.manualKey), null);
  return { key: setup.manualKey, recoveryCodes };
}

beforeAll(resetDb);
beforeEach(() => resetAllLimiters());

describe("sign-in and lockout", () => {
  it("signs in with the right password and resets the failure counter", async () => {
    const u = await account();
    await expect(beginLogin(u.email, "wrong-password-1", meta)).rejects.toMatchObject({ status: 401 });
    const outcome = await beginLogin(u.email, PASSWORD, meta);
    expect(outcome.kind).toBe("session");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
  });

  it("gives the same answer for unknown accounts and wrong passwords", async () => {
    const u = await account();
    const unknown = await beginLogin("nobody@sec.test", PASSWORD, meta).catch((e) => e);
    const wrong = await beginLogin(u.email, "not-the-password-9", meta).catch((e) => e);
    expect([unknown.status, unknown.message]).toEqual([wrong.status, wrong.message]);
  });

  it(`locks the account after ${LOCKOUT_THRESHOLD} failures, even with the right password, until unlocked`, async () => {
    const u = await account();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      resetAllLimiters(); // isolate the persistent lockout from the per-address limiter
      await expect(beginLogin(u.email, `wrong-${i}-password`, meta)).rejects.toMatchObject({ status: 401 });
    }
    await expect(beginLogin(u.email, PASSWORD, meta)).rejects.toMatchObject({ status: 429 });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await unlockAccount(null, u.id);
    expect((await beginLogin(u.email, PASSWORD, meta)).kind).toBe("session");
  });

  it("rate-limits one client address across accounts", async () => {
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) {
      const r = await beginLogin(`spray${i}@sec.test`, "Whatever-123", { ...meta, ip: "198.51.100.1" }).catch((e) => e);
      if (r.status === 429) blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("refuses deactivated accounts", async () => {
    const u = await account();
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    await expect(beginLogin(u.email, PASSWORD, meta)).rejects.toMatchObject({ status: 403 });
  });
});

describe("two-factor authentication", () => {
  it("never stores the secret in plain text or returns it after enrolment", async () => {
    const u = await account();
    const { key } = await enrol(u);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaEnabled).toBe(true);
    expect(row.mfaSecret).not.toContain(key.replace(/ /g, ""));
    expect(row.mfaPendingSecret).toBeNull();
    const status = await mfaStatus(u);
    expect(JSON.stringify(status)).not.toMatch(/secret/i);
    expect(status.recoveryCodesRemaining).toBe(10);
    const users = await listUsers({ page: 1, pageSize: 100, skip: 0, q: "", sort: null, dir: "asc", from: null, to: null }, {});
    expect(JSON.stringify(users)).toContain(u.email);
    expect(JSON.stringify(users)).not.toMatch(/mfaSecret|mfaPendingSecret|passwordHash|codeHash/);
  });

  it("requires a second step, rejects wrong and replayed codes, and accepts the next code", async () => {
    const u = await account();
    const { key } = await enrol(u);
    const first = await beginLogin(u.email, PASSWORD, meta);
    expect(first.kind).toBe("mfa");
    if (first.kind !== "mfa") return;
    await expect(completeMfaLogin(first.challengeToken, { code: "000000" }, meta)).rejects.toMatchObject({ status: 401 });
    // The enrolment code's time step was already used.
    await expect(completeMfaLogin(first.challengeToken, { code: codeFor(key) }, meta)).rejects.toMatchObject({ status: 401 });
    const done = await completeMfaLogin(first.challengeToken, { code: codeFor(key, 1) }, meta);
    expect(done.kind).toBe("session");
    // A used challenge cannot be reused.
    await expect(completeMfaLogin(first.challengeToken, { code: codeFor(key, 1) }, meta)).rejects.toMatchObject({ status: 401 });
  });

  it("accepts each recovery code exactly once", async () => {
    const u = await account();
    const { recoveryCodes } = await enrol(u);
    const a = await beginLogin(u.email, PASSWORD, meta);
    if (a.kind !== "mfa") throw new Error("expected challenge");
    expect((await completeMfaLogin(a.challengeToken, { recoveryCode: recoveryCodes[0].toUpperCase() }, meta)).kind).toBe("session");
    const b = await beginLogin(u.email, PASSWORD, meta);
    if (b.kind !== "mfa") throw new Error("expected challenge");
    await expect(completeMfaLogin(b.challengeToken, { recoveryCode: recoveryCodes[0] }, meta)).rejects.toMatchObject({ status: 401 });
    expect((await mfaStatus(u)).recoveryCodesRemaining).toBe(9);
  });

  it("expires the challenge after too many wrong codes", async () => {
    const u = await account();
    const { key } = await enrol(u);
    const c = await beginLogin(u.email, PASSWORD, meta);
    if (c.kind !== "mfa") throw new Error("expected challenge");
    for (let i = 0; i < 5; i++) await completeMfaLogin(c.challengeToken, { code: "111111" }, meta).catch(() => undefined);
    await expect(completeMfaLogin(c.challengeToken, { code: codeFor(key, 1) }, meta)).rejects.toMatchObject({ status: 401 });
  });

  it("needs the password and a second factor to turn it off", async () => {
    const u = await account();
    const { recoveryCodes } = await enrol(u);
    await expect(disableMfa(u, { password: PASSWORD })).rejects.toMatchObject({ status: 401 });
    await expect(disableMfa(u, { password: "Wrong-pass-12", recoveryCode: recoveryCodes[1] })).rejects.toMatchObject({ status: 401 });
    await disableMfa(u, { password: PASSWORD, recoveryCode: recoveryCodes[1] });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: u.id } })).toBe(0);
    expect((await beginLogin(u.email, PASSWORD, meta)).kind).toBe("session");
  });

  it("lets an administrator remove two-factor for someone else but not for themself", async () => {
    const admin = await account("SUPER_ADMIN");
    const u = await account();
    await enrol(u);
    const { token } = await createSession(u.id);
    await adminResetMfa(admin, u.id);
    expect(await getUserByToken(token)).toBeNull(); // signed out everywhere
    await enrol(admin);
    await expect(adminResetMfa(admin, admin.id)).rejects.toMatchObject({ status: 403 });
  });

  it("re-authentication rejects a wrong password", async () => {
    const u = await account();
    await expect(reauthenticate(u, { password: "nope" })).rejects.toMatchObject({ code: "REAUTH_FAILED" });
    await expect(reauthenticate(u, { password: PASSWORD })).resolves.toBeTruthy();
  });
});

describe("password reset links", () => {
  it("work once, sign the user out everywhere and clear a lockout", async () => {
    const admin = await account("SUPER_ADMIN");
    const u = await account();
    const { token: session } = await createSession(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginCount: 12, lockedUntil: new Date(Date.now() + 600_000) } });
    const link = await createPasswordResetLink(admin, u.id, "http://localhost:3000");
    expect(link.url).toMatch(/\/reset-password#token=[a-f0-9]{64}$/);
    const token = link.url.split("#token=")[1];
    // Only a hash is stored.
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await expect(resetPasswordWithToken(token, "short", meta)).rejects.toMatchObject({ status: 400 });
    await resetPasswordWithToken(token, "Fresh-Tyres-2026", meta);
    expect(await getUserByToken(session)).toBeNull();
    await expect(resetPasswordWithToken(token, "Another-Route-88", meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect((await beginLogin(u.email, "Fresh-Tyres-2026", meta)).kind).toBe("session");
  });

  it("only the newest link works, and expired links are refused", async () => {
    const u = await account();
    const first = (await createPasswordResetLink(null, u.id, "http://x")).url.split("#token=")[1];
    const second = (await createPasswordResetLink(null, u.id, "http://x")).url.split("#token=")[1];
    await expect(resetPasswordWithToken(first, "Brake-Pads-404", meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await prisma.passwordResetToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPasswordWithToken(second, "Brake-Pads-404", meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects malformed tokens without a database lookup", async () => {
    await expect(resetPasswordWithToken("../../etc", "Brake-Pads-404", meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});

describe("session policy", () => {
  it("signs out sessions that have been idle too long", async () => {
    const u = await makeUser("DISPATCHER");
    const { token } = await createSession(u.id);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { lastSeenAt: new Date(Date.now() - 13 * 3_600_000) } });
    expect(await getUserByToken(token)).toBeNull();
  });

  it(`keeps at most ${MAX_SESSIONS_PER_USER} sessions per user, dropping the oldest`, async () => {
    const u = await makeUser("DISPATCHER");
    const first = await createSession(u.id);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) await createSession(u.id);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(MAX_SESSIONS_PER_USER);
    expect(await getUserByToken(first.token)).toBeNull();
  });

  it("purges expired credentials", async () => {
    const u = await makeUser("DISPATCHER");
    await createSession(u.id);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await purgeExpiredCredentials();
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });
});
