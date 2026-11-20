import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { challengeCookieName, getUserByToken, secureCookies, sessionCookieName, type SessionUser } from "./auth";
import { can, homeFor, type Permission } from "./permissions";

/** Current user for Server Components and Route Handlers (null when signed out). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return getUserByToken(jar.get(sessionCookieName())?.value);
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(sessionCookieName())?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(sessionCookieName());
}

/** Page-level guard: redirects to /login when signed out, or home when the role lacks the permission. */
export async function requirePageUser(permission?: Permission | Permission[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission) {
    const list = Array.isArray(permission) ? permission : [permission];
    if (!list.some((p) => can(user.role, p))) redirect(homeFor(user.role));
  }
  return user;
}

/** Short-lived cookie that carries a sign-in through the two-factor step. */
export async function setChallengeCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(challengeCookieName(), token, { httpOnly: true, sameSite: "strict", secure: secureCookies(), path: "/", expires: expiresAt });
}

export async function getChallengeToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(challengeCookieName())?.value ?? null;
}

export async function clearChallengeCookie() {
  const jar = await cookies();
  jar.delete(challengeCookieName());
}
