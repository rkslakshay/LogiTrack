import type { Role } from "./constants";

/**
 * Role-based access control matrix.
 *
 * This file is imported by BOTH the server (API route guards, services) and the
 * client (navigation + button visibility). The server check is authoritative;
 * the client only uses it to avoid showing controls that would be rejected.
 */
export const PERMISSIONS = [
  "dashboard:view",
  "vehicles:read",
  "vehicles:write",
  "drivers:read",
  "drivers:write",
  "deliveries:read", // all deliveries
  "deliveries:write", // create / edit / delete / assign
  "deliveries:status", // change status of any delivery
  "deliveries:own", // driver: read + update status of own deliveries
  "tracking:view",
  "simulator:control",
  "routes:read",
  "routes:write",
  "fuel:read",
  "fuel:write",
  "maintenance:read",
  "maintenance:write",
  "analytics:view",
  "performance:view", // all drivers
  "performance:own",
  "reports:export",
  "notifications:read",
  "activity:read",
  "users:manage",
  "settings:manage",
  "demo:reset", // rebuild the sample dataset (demo mode only)
  "system:diagnostics", // health, jobs and recent errors (Super Admin)
  "system:backup", // create, download and restore database backups (Super Admin)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = PERMISSIONS.filter((p) => p !== "deliveries:own" && p !== "performance:own");

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  FLEET_MANAGER: [
    "dashboard:view",
    "vehicles:read",
    "vehicles:write",
    "drivers:read",
    "drivers:write",
    "deliveries:read",
    "deliveries:write",
    "deliveries:status",
    "tracking:view",
    "simulator:control",
    "routes:read",
    "routes:write",
    "fuel:read",
    "fuel:write",
    "maintenance:read",
    "maintenance:write",
    "analytics:view",
    "performance:view",
    "reports:export",
    "notifications:read",
    "activity:read",
    "demo:reset",
  ],
  DISPATCHER: [
    "dashboard:view",
    "vehicles:read",
    "drivers:read",
    "deliveries:read",
    "deliveries:write",
    "deliveries:status",
    "tracking:view",
    "simulator:control",
    "routes:read",
    "routes:write",
    "notifications:read",
    "demo:reset",
  ],
  DRIVER: ["deliveries:own", "performance:own", "notifications:read"],
};

export function can(role: Role | string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  const list = ROLE_PERMISSIONS[role as Role];
  return !!list && list.includes(permission);
}

export function canAny(role: Role | string | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** Landing page after login for each role. */
export function homeFor(role: Role | string): string {
  return role === "DRIVER" ? "/my-deliveries" : "/dashboard";
}
