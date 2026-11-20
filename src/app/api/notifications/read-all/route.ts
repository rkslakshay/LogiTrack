import { route } from "@/lib/api";
import { markAllRead } from "@/server/services/notifications";

export const POST = route({ permission: "notifications:read" }, ({ user }) => markAllRead(user.id));
