import { route } from "@/lib/api";
import { unreadCount } from "@/server/services/notifications";

export const GET = route({ permission: "notifications:read" }, async ({ user }) => ({ unread: await unreadCount(user.id) }));
