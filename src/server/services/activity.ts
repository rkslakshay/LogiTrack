import { prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { dateRange, orderBy, paged, type ListQuery } from "@/lib/list";

export type ActivityAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "ASSIGN"
  | "UNASSIGN"
  | "STATUS_CHANGE"
  | "COMPLETE"
  | "LOGIN"
  | "LOGOUT"
  | "EXPORT"
  | "SYSTEM";

/** Appends an audit-log entry. `actor` is null for automated (system) actions. */
export async function logActivity(
  db: Db,
  actor: Pick<SessionUser, "id"> | null,
  action: ActivityAction,
  entityType: string,
  entityId: string | null,
  description: string,
) {
  await db.activityLog.create({
    data: { userId: actor?.id ?? null, action, entityType, entityId, description: description.slice(0, 500) },
  });
}

export async function listActivity(list: ListQuery, filters: { entityType?: string | null; action?: string | null; userId?: string | null }) {
  const where = {
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(dateRange(list) ? { createdAt: dateRange(list) } : {}),
    ...(list.q
      ? { OR: [{ description: { contains: list.q } }, { user: { name: { contains: list.q } } }, { entityType: { contains: list.q } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: orderBy(list, ["createdAt", "action", "entityType"] as const, { createdAt: "desc" }),
      skip: list.skip,
      take: list.pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  return paged(items, total, list);
}

export async function activityFacets() {
  const [types, users] = await Promise.all([
    prisma.activityLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { entityTypes: types.map((t) => t.entityType), users };
}
