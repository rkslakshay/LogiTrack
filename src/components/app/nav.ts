import {
  Activity, BarChart3, Bell, ClipboardList, Fuel, Gauge, LayoutDashboard, MapPinned, Package, Route, Settings, Trophy, Truck, UserCog, Users, Wrench,
  FileSpreadsheet, DatabaseBackup, ArrowDownUp, Stethoscope, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these permissions makes the item visible. */
  permissions: Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permissions: ["dashboard:view"] },
      { href: "/my-deliveries", label: "My Deliveries", icon: ClipboardList, permissions: ["deliveries:own"] },
      { href: "/my-performance", label: "My Performance", icon: Gauge, permissions: ["performance:own"] },
    ],
  },
  {
    label: "Fleet Operations",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Truck, permissions: ["vehicles:read"] },
      { href: "/drivers", label: "Drivers", icon: Users, permissions: ["drivers:read"] },
      { href: "/tracking", label: "Live Tracking", icon: MapPinned, permissions: ["tracking:view"] },
      { href: "/deliveries", label: "Deliveries", icon: Package, permissions: ["deliveries:read"] },
      { href: "/routes", label: "Route Planning", icon: Route, permissions: ["routes:read"] },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/fuel", label: "Fuel Management", icon: Fuel, permissions: ["fuel:read"] },
      { href: "/maintenance", label: "Maintenance", icon: Wrench, permissions: ["maintenance:read"] },
      { href: "/notifications", label: "Notifications", icon: Bell, permissions: ["notifications:read"] },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3, permissions: ["analytics:view"] },
      { href: "/performance", label: "Driver Performance", icon: Trophy, permissions: ["performance:view"] },
      { href: "/reports", label: "Reports", icon: FileSpreadsheet, permissions: ["reports:export"] },
      { href: "/import-export", label: "Import & Export", icon: ArrowDownUp, permissions: ["vehicles:read", "drivers:read", "deliveries:read", "fuel:read", "maintenance:read"] },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/activity", label: "Activity Logs", icon: Activity, permissions: ["activity:read"] },
      { href: "/users", label: "User Management", icon: UserCog, permissions: ["users:manage"] },
      { href: "/backups", label: "Backup & Restore", icon: DatabaseBackup, permissions: ["system:backup"] },
      { href: "/diagnostics", label: "Diagnostics", icon: Stethoscope, permissions: ["system:diagnostics"] },
      { href: "/settings", label: "Settings", icon: Settings, permissions: ["notifications:read"] },
    ],
  },
];
