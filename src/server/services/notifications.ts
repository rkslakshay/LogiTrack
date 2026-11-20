import { prisma, type Db } from "@/lib/db";
import type { NotificationCategory, Role, Severity } from "@/lib/constants";
import { paged, type ListQuery } from "@/lib/list";
import { emitUser, EVENTS } from "@/lib/realtime";
import { notFound } from "@/lib/errors";

export interface NotificationPayload {
  category: NotificationCategory;
  severity?: Severity;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  /** When set, at most one notification per user is ever created for this key. */
  dedupeKey?: string;
}

/** Persists a notification for each user and pushes it over Socket.IO. Returns how many were newly created. */
export async function notifyUsers(db: Db, userIds: (string | null | undefined)[], payload: NotificationPayload): Promise<number> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  let created = 0;
  for (const userId of ids) {
    const data = {
      userId,
      category: payload.category,
      severity: payload.severity ?? "INFO",
      title: payload.title,
      message: payload.message,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      dedupeKey: payload.dedupeKey ?? null,
    };
    if (payload.dedupeKey) {
      const existing = await db.notification.findUnique({
        where: { userId_dedupeKey: { userId, dedupeKey: payload.dedupeKey } },
        select: { id: true },
      });
      if (existing) continue;
    }
    const row = await db.notification.create({ data });
    created++;
    emitUser(userId, EVENTS.notification, {
      id: row.id,
      title: row.title,
      message: row.message,
      severity: row.severity,
      category: row.category,
    });
  }
  return created;
}

export async function notifyRoles(db: Db, roles: Role[], payload: NotificationPayload, extraUserIds: (string | null | undefined)[] = []) {
  const users = await db.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
  return notifyUsers(db, [...users.map((u) => u.id), ...extraUserIds], payload);
}

export const OPS_ROLES: Role[] = ["SUPER_ADMIN", "FLEET_MANAGER", "DISPATCHER"];
export const FLEET_ROLES: Role[] = ["SUPER_ADMIN", "FLEET_MANAGER"];

export async function listNotifications(userId: string, list: ListQuery, filters: { category?: string | null; unread?: boolean }) {
  const where = {
    userId,
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.unread ? { isRead: false } : {}),
    ...(list.q ? { OR: [{ title: { contains: list.q } }, { message: { contains: list.q } }] } : {}),
  };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: list.skip, take: list.pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { ...paged(items, total, list), unread };
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

export async function markRead(userId: string, id: string, isRead = true) {
  // Scoped by userId so users can only touch their own notifications.
  const result = await prisma.notification.updateMany({ where: { id, userId }, data: { isRead } });
  if (result.count === 0) throw notFound("Notification");
  return { id, isRead };
}

export async function markAllRead(userId: string) {
  const result = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  return { updated: result.count };
}

export async function deleteNotification(userId: string, id: string) {
  const result = await prisma.notification.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw notFound("Notification");
  return { id };
}
