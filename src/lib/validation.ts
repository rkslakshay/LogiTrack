import { z } from "zod";
import { passwordProblems } from "./password-policy";
import {
  DELIVERY_STATUSES,
  FUEL_TYPES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  PRIORITIES,
  ROLES,
  VEHICLE_TYPES,
} from "./constants";

// Schemas are shared by the API (authoritative) and the forms (instant feedback).

const text = (label: string, max = 120) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => (v ? v : null));

const optionalId = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null));

const date = (label: string) => z.coerce.date({ error: `${label} is required` });

const optionalDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable());

const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.coerce.number().int("Must be a whole number").min(0, "Cannot be negative").nullable(),
);

/** Indian mobile number, optionally prefixed with +91. */
export const phone = z
  .string({ error: "Phone number is required" })
  .trim()
  .regex(/^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/, "Enter a valid Indian mobile number, e.g. +91 98765 43210");

const email = z.string({ error: "Email is required" }).trim().toLowerCase().pipe(z.email("Enter a valid email address"));

/**
 * Password rules without personal context (see lib/password-policy.ts). Services
 * additionally refuse passwords that contain the person's name or e-mail name.
 */
export const password = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number")
  .superRefine((value, ctx) => {
    const problem = passwordProblems(value).find((p) => !/at least|letter|number/.test(p));
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const lat = z.coerce.number({ error: "Latitude is required" }).min(-90, "Invalid latitude").max(90, "Invalid latitude");
const lng = z.coerce.number({ error: "Longitude is required" }).min(-180, "Invalid longitude").max(180, "Invalid longitude");

// --- Auth & users ---------------------------------------------------------------

export const loginSchema = z.object({
  email,
  password: z.string({ error: "Password is required" }).min(1, "Password is required"),
});

export const userCreateSchema = z.object({
  name: text("Name"),
  email,
  phone: z.preprocess((v) => (v === "" || v == null ? null : v), phone.nullable()),
  role: z.enum(ROLES, { error: "Select a role" }),
  password,
  isActive: z.boolean().default(true),
});

export const userUpdateSchema = userCreateSchema.omit({ password: true }).extend({
  // Optional password reset by an administrator.
  password: z.preprocess((v) => (v === "" || v == null ? undefined : v), password.optional()),
});

export const profileSchema = z.object({
  name: text("Name"),
  phone: z.preprocess((v) => (v === "" || v == null ? null : v), phone.nullable()),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
    confirmPassword: z.string().min(1, "Please confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });

// --- Vehicles -------------------------------------------------------------------

/** Indian registration mark, e.g. MH 12 AB 1234 or DL 1C AA 1234 (also BH series: 22 BH 1234 AA). */
export const registrationNumber = z
  .string({ error: "Registration number is required" })
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]+/g, " "))
  .pipe(
    z
      .string()
      .regex(
        // State + RTO code (Delhi RTOs carry a letter, e.g. DL 1C) + series + number.
        /^([A-Z]{2} ?\d{1,2}[A-Z]? ?[A-Z]{1,3} ?\d{4}|\d{2} ?BH ?\d{4} ?[A-Z]{1,2})$/,
        "Use the Indian format, e.g. MH 12 AB 1234",
      ),
  );

const currentYear = new Date().getFullYear();

export const vehicleSchema = z.object({
  registrationNumber,
  name: text("Vehicle name"),
  type: z.enum(VEHICLE_TYPES, { error: "Select a vehicle type" }),
  manufacturer: text("Manufacturer"),
  model: text("Model"),
  year: z.coerce
    .number({ error: "Year is required" })
    .int()
    .min(1990, "Year must be 1990 or later")
    .max(currentYear + 1, "Year cannot be in the future"),
  fuelType: z.enum(FUEL_TYPES, { error: "Select a fuel type" }),
  fuelCapacity: z.coerce.number({ error: "Fuel capacity is required" }).positive("Must be greater than 0").max(1000),
  odometer: z.coerce.number({ error: "Odometer is required" }).int("Must be a whole number").min(0, "Cannot be negative"),
  // ON_DELIVERY is managed by the delivery workflow and cannot be set by hand.
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"], { error: "Select a status" }).default("AVAILABLE"),
  insuranceExpiry: date("Insurance expiry"),
  registrationExpiry: date("Registration expiry"),
  assignedDriverId: optionalId,
  lastLat: z.preprocess((v) => (v === "" || v == null ? null : v), lat.nullable()),
  lastLng: z.preprocess((v) => (v === "" || v == null ? null : v), lng.nullable()),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

// --- Drivers --------------------------------------------------------------------

export const driverSchema = z.object({
  fullName: text("Full name"),
  email,
  phone,
  address: text("Address", 250),
  licenseNumber: z
    .string({ error: "License number is required" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[- ]?\d{2}[- ]?\d{4}[- ]?\d{7}$/, "Use the Indian format, e.g. MH12 2019 0045678"),
  licenseExpiry: date("License expiry"),
  joiningDate: date("Joining date"),
  // ON_DELIVERY is managed by the delivery workflow.
  status: z.enum(["AVAILABLE", "OFF_DUTY", "INACTIVE"], { error: "Select a status" }).default("AVAILABLE"),
  assignedVehicleId: optionalId,
  /** When provided, a DRIVER login account is created (or its password reset). */
  loginPassword: z.preprocess((v) => (v === "" || v == null ? undefined : v), password.optional()),
});
export type DriverInput = z.infer<typeof driverSchema>;

// --- Deliveries -----------------------------------------------------------------

export const deliverySchema = z
  .object({
    customerName: text("Customer name"),
    customerPhone: phone,
    pickupAddress: text("Pickup location", 250),
    destinationAddress: text("Destination", 250),
    pickupLat: lat,
    pickupLng: lng,
    destLat: lat,
    destLng: lng,
    scheduledAt: date("Scheduled date"),
    expectedAt: date("Expected delivery time"),
    priority: z.enum(PRIORITIES, { error: "Select a priority" }).default("NORMAL"),
    notes: optionalText(1000),
    driverId: optionalId,
    vehicleId: optionalId,
  })
  .refine((v) => v.expectedAt > v.scheduledAt, {
    path: ["expectedAt"],
    message: "Expected delivery must be after the scheduled time",
  })
  .refine((v) => !(v.pickupLat === v.destLat && v.pickupLng === v.destLng), {
    path: ["destinationAddress"],
    message: "Destination must differ from the pickup location",
  })
  .refine((v) => !!v.driverId === !!v.vehicleId, {
    path: ["vehicleId"],
    message: "Select both a driver and a vehicle, or neither",
  });
export type DeliveryInput = z.infer<typeof deliverySchema>;

export const assignSchema = z.object({
  driverId: z.string({ error: "Select a driver" }).min(1, "Select a driver"),
  vehicleId: z.string({ error: "Select a vehicle" }).min(1, "Select a vehicle"),
});

export const statusChangeSchema = z.object({
  status: z.enum(DELIVERY_STATUSES, { error: "Select a status" }),
  note: optionalText(500),
});

export const issueSchema = z.object({ note: text("Issue description", 500) });

// --- Routes ---------------------------------------------------------------------

export const routePreviewSchema = z.object({
  start: z.object({ label: text("Start label", 200), lat, lng }),
  deliveryIds: z.array(z.string()).min(1, "Select at least one delivery").max(25, "At most 25 stops per route"),
  strategy: z.enum(["original", "nearestNeighbor", "optimized"]).default("optimized"),
});

export const routeCreateSchema = routePreviewSchema.extend({
  name: text("Route name"),
  driverId: optionalId,
  vehicleId: optionalId,
});

export const pointRouteSchema = z.object({
  from: z.object({ lat, lng }),
  to: z.object({ lat, lng }),
});

// --- Fuel -----------------------------------------------------------------------

export const fuelSchema = z.object({
  vehicleId: z.string({ error: "Select a vehicle" }).min(1, "Select a vehicle"),
  date: date("Fuel date").refine((d) => d.getTime() <= Date.now() + 86_400_000, "Fuel date cannot be in the future"),
  quantityL: z.coerce
    .number({ error: "Quantity is required" })
    .positive("Quantity must be greater than 0")
    .max(1000, "Quantity looks too large"),
  pricePerLitre: z.coerce
    .number({ error: "Price per litre is required" })
    .positive("Price must be greater than 0")
    .max(500, "Price per litre looks too large"),
  odometer: z.coerce.number({ error: "Odometer reading is required" }).int("Must be a whole number").min(0, "Cannot be negative"),
  station: text("Fuel station"),
  notes: optionalText(500),
});
export type FuelInput = z.infer<typeof fuelSchema>;

// --- Maintenance ----------------------------------------------------------------

export const maintenanceSchema = z.object({
  vehicleId: z.string({ error: "Select a vehicle" }).min(1, "Select a vehicle"),
  type: z.enum(MAINTENANCE_TYPES, { error: "Select a maintenance type" }),
  description: text("Description", 500),
  serviceDate: date("Service date"),
  nextServiceDate: optionalDate,
  nextServiceOdometer: optionalInt,
  odometer: optionalInt,
  cost: z.coerce.number({ error: "Cost is required" }).min(0, "Cost cannot be negative").max(10_000_000).default(0),
  provider: text("Service provider"),
  status: z.enum(MAINTENANCE_STATUSES).default("SCHEDULED"),
});
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;

export const maintenanceCompleteSchema = z.object({
  cost: z.coerce.number({ error: "Final cost is required" }).min(0, "Cost cannot be negative").max(10_000_000),
  odometer: optionalInt,
  nextServiceDate: optionalDate,
  nextServiceOdometer: optionalInt,
});

// --- Settings -------------------------------------------------------------------

export const settingsSchema = z.object({
  companyName: text("Company name"),
  simulationSpeed: z.coerce.number().min(1, "Minimum is 1x").max(240, "Maximum is 240x"),
  averageSpeedKmh: z.coerce.number().min(10, "Minimum is 10 km/h").max(100, "Maximum is 100 km/h"),
  simulationAutoComplete: z.coerce.boolean(),
  maintenanceReminderDays: z.coerce.number().int().min(1).max(90),
  maintenanceReminderKm: z.coerce.number().int().min(50).max(10_000),
  complianceReminderDays: z.coerce.number().int().min(1).max(180),
});

// --- Account security (v3) -----------------------------------------------------------

const totpCode = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"));
const optionalTotp = z.preprocess((v) => (v === "" || v == null ? undefined : v), totpCode.optional());
const optionalRecovery = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().trim().max(20, "Invalid recovery code").optional(),
);

/** Second sign-in step: a TOTP code or a recovery code. */
export const mfaVerifySchema = z
  .object({ code: optionalTotp, recoveryCode: optionalRecovery })
  .refine((v) => !!v.code || !!v.recoveryCode, { path: ["code"], message: "Enter a code" });

export const mfaSetupSchema = z.object({ password: z.string().min(1, "Enter your password") });
export const mfaConfirmSchema = z.object({ code: totpCode });

/** Password plus, for accounts with two-factor, a current code (sensitive actions). */
export const reauthSchema = z.object({
  password: z.string().min(1, "Enter your password"),
  code: optionalTotp,
  recoveryCode: optionalRecovery,
});

export const passwordResetSchema = z
  .object({
    token: z.string().trim().min(1, "This reset link is incomplete"),
    newPassword: password,
    confirmPassword: z.string().min(1, "Please confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

/** Typed confirmation for destructive maintenance actions (restore). */
export const restoreSchema = reauthSchema.extend({
  confirm: z.literal("RESTORE", { error: 'Type RESTORE to confirm' }),
});
