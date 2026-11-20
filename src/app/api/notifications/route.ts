import { parseListQuery, route } from "@/lib/api";
import { listNotifications } from "@/server/services/notifications";

export const GET = route({ permission: "notifications:read" }, ({ user, query }) =>
  listNotifications(user.id, parseListQuery(query, { pageSize: 15 }), { category: query.get("category"), unread: query.get("unread") === "true" }),
);
