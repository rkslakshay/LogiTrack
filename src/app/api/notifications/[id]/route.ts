import { z } from "zod";
import { route } from "@/lib/api";
import { deleteNotification, markRead } from "@/server/services/notifications";

const schema = z.object({ isRead: z.boolean() });

export const PATCH = route({ permission: "notifications:read", body: schema }, ({ user, params, body }) => markRead(user.id, params.id, body.isRead));
export const DELETE = route({ permission: "notifications:read" }, ({ user, params }) => deleteNotification(user.id, params.id));
