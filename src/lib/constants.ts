// Single source of truth for enum-like values shared by the database layer,
// Zod validation and the UI.

export const ROLES = ["SUPER_ADMIN", "FLEET_MANAGER", "DISPATCHER", "DRIVER"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  FLEET_MANAGER: "Fleet Manager",
  DISPATCHER: "Dispatcher",
  DRIVER: "Driver",
};

export const VEHICLE_TYPES = ["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "BIKE", "CONTAINER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  TRUCK: "Truck",
  MINI_TRUCK: "Mini Truck",
  VAN: "Van",
  PICKUP: "Pickup",
  BIKE: "Two-Wheeler",
  CONTAINER: "Container",
};

export const FUEL_TYPES = ["DIESEL", "PETROL", "CNG", "ELECTRIC"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  DIESEL: "Diesel",
  PETROL: "Petrol",
  CNG: "CNG",
  ELECTRIC: "Electric",
};

export const VEHICLE_STATUSES = ["AVAILABLE", "ON_DELIVERY", "MAINTENANCE", "INACTIVE"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const DRIVER_STATUSES = ["AVAILABLE", "ON_DELIVERY", "OFF_DUTY", "INACTIVE"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "DELAYED",
  "FAILED",
  "CANCELLED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Statuses in which a delivery occupies its driver and vehicle. */
export const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"];
export const TERMINAL_DELIVERY_STATUSES: DeliveryStatus[] = ["DELIVERED", "FAILED", "CANCELLED"];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAINTENANCE_TYPES = [
  "GENERAL_SERVICE",
  "OIL_CHANGE",
  "TYRE",
  "BRAKE",
  "ENGINE",
  "BATTERY",
  "INSPECTION",
  "REPAIR",
] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  GENERAL_SERVICE: "General Service",
  OIL_CHANGE: "Oil Change",
  TYRE: "Tyre Replacement",
  BRAKE: "Brake Service",
  ENGINE: "Engine Work",
  BATTERY: "Battery",
  INSPECTION: "Inspection",
  REPAIR: "Repair",
};

export const MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const ROUTE_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const NOTIFICATION_CATEGORIES = ["DELIVERY", "MAINTENANCE", "COMPLIANCE", "VEHICLE", "SYSTEM"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const SEVERITIES = ["INFO", "SUCCESS", "WARNING", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** "ON_DELIVERY" -> "On Delivery" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Default (non-HTTPS) session cookie name. Server code uses sessionCookieName() from lib/auth. */
export const SESSION_COOKIE = "lt_session";

/** Default system settings; overridable from the Settings page (stored in the Setting table). */
export const DEFAULT_SETTINGS = {
  companyName: "LogiTrack Logistics Pvt. Ltd.",
  // Simulated seconds that pass per real second in the GPS simulator.
  simulationSpeed: "10",
  // Average cruising speed used for ETA estimates and the simulator (km/h).
  averageSpeedKmh: "40",
  // Complete a delivery automatically when the simulated vehicle reaches the destination.
  simulationAutoComplete: "true",
  // Reminder windows.
  maintenanceReminderDays: "7",
  maintenanceReminderKm: "500",
  complianceReminderDays: "30",
} as const;
export type SettingKey = keyof typeof DEFAULT_SETTINGS;
