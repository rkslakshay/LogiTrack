import { route } from "@/lib/api";
import { destroySession } from "@/lib/auth";
import { clearSessionCookie, getSessionToken } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logActivity } from "@/server/services/activity";

export const POST = route({ auth: false }, async ({ user }) => {
  await destroySession(await getSessionToken());
  await clearSessionCookie();
  if (user) logger("auth").info("logout", { userId: user.id });
  if (user) await logActivity(prisma, user, "LOGOUT", "User", user.id, `${user.name} signed out`);
  return { ok: true };
});
