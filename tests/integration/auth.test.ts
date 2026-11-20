import { beforeAll, describe, expect, it } from "vitest";
import {
  clearLoginFailures, createSession, destroySession, destroyUserSessions, getUserByToken, hashPassword, loginThrottled, parseCookie, recordLoginFailure,
  verifyPassword,
} from "@/lib/auth";
import { changePassword, createUser, deactivateUser, listUsers, updateUser } from "@/server/services/users";
import { makeUser, prisma, resetDb } from "../helpers";

beforeAll(resetDb);

describe("password hashing", () => {
  it("never stores the plain password and verifies correctly", async () => {
    const hash = await hashPassword("Admin@123");
    expect(hash).not.toContain("Admin@123");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt
    expect(await verifyPassword("Admin@123", hash)).toBe(true);
    expect(await verifyPassword("admin@123", hash)).toBe(false);
  });

  it("salts hashes so equal passwords differ", async () => {
    expect(await hashPassword("Same@1234")).not.toBe(await hashPassword("Same@1234"));
  });
});

describe("sessions", () => {
  it("creates a session and resolves the user from the token", async () => {
    const user = await makeUser("DISPATCHER");
    const { token, expiresAt } = await createSession(user.id, "vitest");
    expect(token).toHaveLength(64);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const resolved = await getUserByToken(token);
    expect(resolved).toMatchObject({ id: user.id, role: "DISPATCHER", email: user.email });
    // Only a hash of the token is stored.
    expect(await prisma.session.findFirst({ where: { tokenHash: token } })).toBeNull();
  });

  it("rejects unknown, malformed and missing tokens", async () => {
    expect(await getUserByToken("f".repeat(64))).toBeNull();
    expect(await getUserByToken("short")).toBeNull();
    expect(await getUserByToken(null)).toBeNull();
  });

  it("rejects and removes expired sessions", async () => {
    const user = await makeUser("DISPATCHER");
    const { token } = await createSession(user.id);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getUserByToken(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects sessions of deactivated users", async () => {
    const user = await makeUser("FLEET_MANAGER");
    const { token } = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await getUserByToken(token)).toBeNull();
  });

  it("logs out one session or all sessions", async () => {
    const user = await makeUser("DISPATCHER");
    const a = await createSession(user.id);
    const b = await createSession(user.id);
    await destroySession(a.token);
    expect(await getUserByToken(a.token)).toBeNull();
    expect(await getUserByToken(b.token)).not.toBeNull();

    const c = await createSession(user.id);
    await destroyUserSessions(user.id, c.token);
    expect(await getUserByToken(b.token)).toBeNull();
    expect(await getUserByToken(c.token)).not.toBeNull();
  });

  it("exposes the linked driver profile on the session user", async () => {
    const user = await makeUser("DRIVER");
    const driver = await prisma.driver.create({
      data: {
        code: "DRV-9001", userId: user.id, fullName: "Linked Driver", email: "linked@test.in", phone: "+91 98765 43210", address: "x",
        licenseNumber: "MH12 2020 9999999", licenseExpiry: new Date(Date.now() + 1e10), joiningDate: new Date(),
      },
    });
    const { token } = await createSession(user.id);
    expect((await getUserByToken(token))?.driverId).toBe(driver.id);
  });
});

describe("login throttling and cookies", () => {
  it("blocks after repeated failures and resets on success", () => {
    const key = "someone@test.in|1.2.3.4";
    expect(loginThrottled(key)).toBe(false);
    for (let i = 0; i < 8; i++) recordLoginFailure(key);
    expect(loginThrottled(key)).toBe(true);
    expect(loginThrottled("other@test.in|1.2.3.4")).toBe(false);
    clearLoginFailures(key);
    expect(loginThrottled(key)).toBe(false);
  });

  it("parses the session cookie out of a cookie header", () => {
    expect(parseCookie("a=1; lt_session=abc123; b=2", "lt_session")).toBe("abc123");
    expect(parseCookie("a=1", "lt_session")).toBeNull();
    expect(parseCookie(undefined, "lt_session")).toBeNull();
  });
});

describe("user management", () => {
  it("creates users with a hashed password and never returns the hash", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const created = await createUser(admin, { name: "Meera Iyer", email: "meera@test.in", phone: null, role: "DISPATCHER", password: "Welcome@123", isActive: true });
    expect(created).not.toHaveProperty("passwordHash");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(await verifyPassword("Welcome@123", row.passwordHash)).toBe(true);

    const list = await listUsers({ page: 1, pageSize: 50, skip: 0, q: "meera", sort: null, dir: "desc", from: null, to: null }, {});
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("passwordHash");
  });

  it("stops admins from demoting or deactivating themselves", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    await expect(updateUser(admin, admin.id, { name: admin.name, email: admin.email, phone: null, role: "DISPATCHER", isActive: true })).rejects.toThrow(/own role/);
    await expect(deactivateUser(admin, admin.id)).rejects.toThrow(/own account/);
  });

  it("always keeps one active super admin", async () => {
    await prisma.user.updateMany({ where: { role: "SUPER_ADMIN" }, data: { isActive: false } });
    const last = await makeUser("SUPER_ADMIN");
    const other = await makeUser("FLEET_MANAGER");
    // (Authorisation is enforced at the API layer; this exercises the invariant itself.)
    await expect(deactivateUser(other, last.id)).rejects.toThrow(/last active Super Admin/);
  });

  it("signs a user out everywhere when they are deactivated", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const target = await makeUser("DISPATCHER");
    const { token } = await createSession(target.id);
    await deactivateUser(admin, target.id);
    expect(await getUserByToken(token)).toBeNull();
    expect(await prisma.activityLog.count({ where: { entityType: "User", entityId: target.id, action: "DELETE" } })).toBe(1);
  });

  it("changes a password only with the correct current password", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const user = await createUser(admin, { name: "Pw User", email: "pw@test.in", phone: null, role: "DISPATCHER", password: "Start@123", isActive: true });
    const actor = { id: user.id, name: user.name, email: user.email, phone: null, role: "DISPATCHER" as const, driverId: null };
    const keep = await createSession(user.id);
    const other = await createSession(user.id);

    await expect(changePassword(actor, { currentPassword: "wrong", newPassword: "Next@1234" }, keep.token)).rejects.toThrow(/incorrect/);
    await changePassword(actor, { currentPassword: "Start@123", newPassword: "Next@1234" }, keep.token);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("Next@1234", row.passwordHash)).toBe(true);
    // The current session survives, every other session is revoked.
    expect(await getUserByToken(keep.token)).not.toBeNull();
    expect(await getUserByToken(other.token)).toBeNull();
  });
});
