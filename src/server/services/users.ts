import type { z } from "zod";
import { prisma } from "@/lib/db";
import { destroyUserSessions, hashPassword, verifyPassword, type SessionUser } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { orderBy, paged, type ListQuery } from "@/lib/list";
import type { userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { logActivity } from "./activity";
import { assertStrongPassword } from "./account";

// passwordHash is never selected for API responses.
const publicUser = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
  // Security state only: never the TOTP secret, recovery codes or the password hash.
  mfaEnabled: true, lockedUntil: true, failedLoginCount: true,
  driver: { select: { id: true, code: true } },
} as const;

export async function listUsers(list: ListQuery, filters: { role?: string | null; active?: string | null }) {
  const where = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.active === "yes" ? { isActive: true } : filters.active === "no" ? { isActive: false } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q } }, { email: { contains: list.q } }, { phone: { contains: list.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: publicUser,
      orderBy: orderBy(list, ["name", "email", "role", "isActive", "lastLoginAt", "createdAt"] as const, { createdAt: "asc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return paged(items, total, list);
}

export async function createUser(actor: SessionUser, input: z.infer<typeof userCreateSchema>) {
  const { password, ...data } = input;
  assertStrongPassword(password, { email: data.email, name: data.name });
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...data, passwordHash: await hashPassword(password), passwordChangedAt: new Date() }, select: publicUser });
    await logActivity(tx, actor, "CREATE", "User", user.id, `Created ${ROLE_LABELS[user.role as Role]} account for ${user.name}`);
    return user;
  });
}

/** The system must always keep at least one active Super Admin. */
async function assertNotLastAdmin(userId: string) {
  const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: userId } } });
  if (others === 0) throw conflict("This is the last active Super Admin. Create another Super Admin first.");
}

export async function updateUser(actor: SessionUser, id: string, input: z.infer<typeof userUpdateSchema>) {
  const existing = await prisma.user.findUnique({ where: { id }, include: { driver: true } });
  if (!existing) throw notFound("User");
  const { password, ...data } = input;

  if (id === actor.id && (data.role !== existing.role || !data.isActive)) {
    throw conflict("You cannot change your own role or deactivate your own account.");
  }
  if (existing.role === "SUPER_ADMIN" && existing.isActive && (data.role !== "SUPER_ADMIN" || !data.isActive)) {
    await assertNotLastAdmin(id);
  }
  if (password) assertStrongPassword(password, { email: data.email, name: data.name });
  if (existing.driver && data.role !== "DRIVER") {
    throw conflict("This account is linked to a driver profile and must keep the Driver role.", { role: "Linked to a driver profile" });
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { ...data, ...(password ? { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } : {}) },
      select: publicUser,
    });
    const changes = [
      existing.role !== data.role ? `role ${ROLE_LABELS[existing.role as Role]} → ${ROLE_LABELS[data.role]}` : null,
      existing.isActive !== data.isActive ? (data.isActive ? "reactivated" : "deactivated") : null,
      password ? "password reset" : null,
    ].filter(Boolean);
    await logActivity(tx, actor, "UPDATE", "User", id, `Updated user ${updated.name}${changes.length ? ` (${changes.join(", ")})` : ""}`);
    return updated;
  });
  // Role changes, deactivation and password resets invalidate existing sessions.
  if (!data.isActive || password || existing.role !== data.role) await destroyUserSessions(id);
  return user;
}

/** Accounts are deactivated rather than deleted so audit history keeps its author. */
export async function deactivateUser(actor: SessionUser, id: string) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound("User");
  if (id === actor.id) throw conflict("You cannot deactivate your own account.");
  if (existing.role === "SUPER_ADMIN" && existing.isActive) await assertNotLastAdmin(id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { isActive: false } });
    await logActivity(tx, actor, "DELETE", "User", id, `Deactivated user ${existing.name}`);
  });
  await destroyUserSessions(id);
  return { id };
}

export async function updateProfile(actor: SessionUser, input: { name: string; phone: string | null }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: actor.id }, data: input, select: publicUser });
    if (actor.driverId) {
      await tx.driver.update({ where: { id: actor.driverId }, data: { fullName: input.name, ...(input.phone ? { phone: input.phone } : {}) } });
    }
    await logActivity(tx, actor, "UPDATE", "User", actor.id, `${user.name} updated their profile`);
    return user;
  });
}

export async function changePassword(actor: SessionUser, input: { currentPassword: string; newPassword: string }, keepToken: string | null) {
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user) throw notFound("User");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw badRequest("Current password is incorrect.", { currentPassword: "Incorrect password" });
  }
  assertStrongPassword(input.newPassword, { email: user.email, name: user.name }, "newPassword");
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() } });
  await logActivity(prisma, actor, "UPDATE", "User", actor.id, `${user.name} changed their password`);
  // Sign out every other device.
  await destroyUserSessions(actor.id, keepToken);
  return { ok: true };
}
