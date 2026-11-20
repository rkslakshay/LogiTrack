import { Prisma } from "@prisma/client";
import { format } from "date-fns";
import type { z } from "zod";
import type { SessionUser } from "@/lib/auth";
import {
  FUEL_TYPE_LABELS, FUEL_TYPES, MAINTENANCE_STATUSES, MAINTENANCE_TYPE_LABELS, MAINTENANCE_TYPES, PRIORITIES, VEHICLE_TYPE_LABELS, VEHICLE_TYPES,
  humanize,
} from "@/lib/constants";
import { CsvParseError, parseCsv, toCsv, unguard, type CsvValue } from "@/lib/csv";
import { prisma, type Db } from "@/lib/db";
import { ApiError, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { can, type Permission } from "@/lib/permissions";
import { deliverySchema, driverSchema, fuelSchema, maintenanceSchema, registrationNumber, vehicleSchema } from "@/lib/validation";
import { logActivity } from "./activity";
import { insertPendingDelivery } from "./deliveries";
import { insertDriver } from "./drivers";
import { insertFuel } from "./fuel";
import { insertMaintenance } from "./maintenance";
import { getSettings } from "./settings";
import { insertVehicle } from "./vehicles";

/**
 * CSV import and import-compatible export.
 *
 * Every row goes through the same Zod schema and the same service insert function as
 * the forms, so an import can never create something the UI would refuse. A preview
 * runs the real inserts inside a transaction that is always rolled back; a commit
 * re-reads and re-validates the file (nothing from the preview is trusted) and writes
 * all rows in ONE transaction. Unless the user explicitly chooses to skip invalid rows,
 * a single bad row means nothing is imported.
 */

const log = logger("import");

export const IMPORT_ENTITIES = ["vehicles", "drivers", "deliveries", "fuel", "maintenance"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export interface ColumnSpec {
  /** Header written in templates and exports. */
  header: string;
  /** Schema field the value feeds. */
  field: string;
  required: boolean;
  description: string;
  example: string;
  /** Other accepted header spellings (e.g. from the report exports). */
  aliases?: string[];
}

interface Context {
  tx: Db;
  vehiclesByReg: Map<string, string>;
  averageSpeedKmh: number;
}

interface EntityDef {
  label: { one: string; many: string };
  write: Permission;
  read: Permission;
  columns: ColumnSpec[];
  schema: z.ZodType;
  /** Converts raw cell text to schema input. Throws CellError for values that cannot be read at all. */
  toInput: (raw: Record<string, string>, ctx: Context) => Record<string, unknown>;
  /** Natural key for duplicate detection inside the file and against the database. */
  key: (input: Record<string, unknown>) => string;
  existing: (tx: Db, input: Record<string, unknown>) => Promise<string | null>;
  insert: (tx: Db, actor: SessionUser, input: never, ctx: Context) => Promise<{ id: string; code?: string | null }>;
  /** Rows for export, in template column order. */
  exportRows: (filters: ExportFilters) => Promise<CsvValue[][]>;
}

export interface ExportFilters {
  q?: string | null;
  status?: string | null;
  from?: Date | null;
  to?: Date | null;
  ids?: string[] | null;
}

class CellError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

// --- Value readers -----------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function enumValue(field: string, value: string, values: readonly string[], labels: Record<string, string> = {}): string | undefined {
  if (!value) return undefined;
  const n = norm(value);
  const hit = values.find((v) => norm(v) === n || (labels[v] && norm(labels[v]) === n));
  if (!hit) throw new CellError(field, `"${value}" is not one of: ${values.map((v) => labels[v] ?? humanize(v)).join(", ")}`);
  return hit;
}

/** Dates: 2026-01-31, 2026-01-31 14:30, ISO 8601, or Indian day-first 31/01/2026 and 31-01-2026. */
export function readDate(field: string, value: string): Date | undefined {
  if (!value) return undefined;
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (m) return checked(field, value, +m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(v);
  if (m) return checked(field, value, +m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), 0);
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(v);
  throw new CellError(field, `"${value}" is not a date. Use YYYY-MM-DD (or DD/MM/YYYY), optionally with HH:MM.`);
}

function checked(field: string, raw: string, y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) {
    throw new CellError(field, `"${raw}" is not a real date.`);
  }
  return date;
}

/** Numbers: "1,25,000", "₹ 102.50", "60". Empty stays empty. */
export function readNumber(field: string, value: string): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new CellError(field, `"${value}" is not a number.`);
  return Number(cleaned);
}

function vehicleId(field: string, value: string, ctx: Context): string | undefined {
  if (!value) return undefined;
  const parsed = registrationNumber.safeParse(value);
  const reg = parsed.success ? parsed.data : value.trim().toUpperCase();
  const id = ctx.vehiclesByReg.get(reg);
  if (!id) throw new CellError(field, `No vehicle with registration "${value}". Import or add the vehicle first.`);
  return id;
}

const day = (d: unknown) => (d instanceof Date ? format(d, "yyyy-MM-dd") : "");
const minute = (d: unknown) => (d instanceof Date ? format(d, "yyyy-MM-dd HH:mm") : "");
const rupees = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2));
const lower = (s: unknown) => String(s ?? "").toLowerCase();

function range(field: string, f: ExportFilters) {
  return f.from || f.to ? { [field]: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {};
}
const ids = (f: ExportFilters) => (f.ids?.length ? { id: { in: f.ids } } : {});

// --- Entities ----------------------------------------------------------------------

const ENTITIES: Record<ImportEntity, EntityDef> = {
  vehicles: {
    label: { one: "vehicle", many: "vehicles" },
    write: "vehicles:write",
    read: "vehicles:read",
    schema: vehicleSchema,
    columns: [
      { header: "Registration Number", field: "registrationNumber", required: true, description: "Indian format, e.g. MH 12 AB 1234. Must be unique.", example: "MH 12 AB 4521", aliases: ["Registration"] },
      { header: "Name", field: "name", required: true, description: "A short name for the vehicle.", example: "Pune Van 7", aliases: ["Vehicle Name"] },
      { header: "Type", field: "type", required: true, description: Object.values(VEHICLE_TYPE_LABELS).join(", "), example: "Van" },
      { header: "Manufacturer", field: "manufacturer", required: true, description: "e.g. Tata, Ashok Leyland, Mahindra.", example: "Tata" },
      { header: "Model", field: "model", required: true, description: "Model name.", example: "Winger" },
      { header: "Year", field: "year", required: true, description: "1990 to next year.", example: "2022" },
      { header: "Fuel Type", field: "fuelType", required: true, description: Object.values(FUEL_TYPE_LABELS).join(", "), example: "Diesel", aliases: ["Fuel"] },
      { header: "Fuel Capacity (L)", field: "fuelCapacity", required: true, description: "Tank size in litres (battery kWh for electric).", example: "60" },
      { header: "Odometer (km)", field: "odometer", required: true, description: "Whole kilometres.", example: "18450" },
      { header: "Status", field: "status", required: false, description: "Available (default), Maintenance or Inactive.", example: "Available" },
      { header: "Insurance Expiry", field: "insuranceExpiry", required: true, description: "YYYY-MM-DD or DD/MM/YYYY.", example: "2027-03-31" },
      { header: "Registration Expiry", field: "registrationExpiry", required: true, description: "YYYY-MM-DD or DD/MM/YYYY.", example: "2034-06-30" },
    ],
    toInput: (r) => ({
      registrationNumber: r.registrationNumber,
      name: r.name,
      type: enumValue("type", r.type, VEHICLE_TYPES, VEHICLE_TYPE_LABELS),
      manufacturer: r.manufacturer,
      model: r.model,
      year: readNumber("year", r.year),
      fuelType: enumValue("fuelType", r.fuelType, FUEL_TYPES, FUEL_TYPE_LABELS),
      fuelCapacity: readNumber("fuelCapacity", r.fuelCapacity),
      odometer: readNumber("odometer", r.odometer),
      status: enumValue("status", r.status, ["AVAILABLE", "MAINTENANCE", "INACTIVE"]),
      insuranceExpiry: readDate("insuranceExpiry", r.insuranceExpiry),
      registrationExpiry: readDate("registrationExpiry", r.registrationExpiry),
      assignedDriverId: null,
      lastLat: null,
      lastLng: null,
    }),
    key: (i) => `reg:${i.registrationNumber}`,
    existing: async (tx, i) => {
      const v = await tx.vehicle.findUnique({ where: { registrationNumber: String(i.registrationNumber) } });
      return v ? `Registration number already belongs to ${v.code}${v.deletedAt ? " (a deleted vehicle)" : ""}.` : null;
    },
    insert: (tx, actor, input) => insertVehicle(tx, actor, input, { quiet: true }),
    exportRows: async (f) => {
      const rows = await prisma.vehicle.findMany({
        where: { deletedAt: null, ...ids(f), ...(f.status ? { status: f.status } : {}), ...(f.q ? { OR: [{ registrationNumber: { contains: f.q } }, { name: { contains: f.q } }] } : {}) },
        orderBy: { code: "asc" },
      });
      return rows.map((v) => [
        v.registrationNumber, v.name, VEHICLE_TYPE_LABELS[v.type as keyof typeof VEHICLE_TYPE_LABELS] ?? v.type, v.manufacturer, v.model, v.year,
        FUEL_TYPE_LABELS[v.fuelType as keyof typeof FUEL_TYPE_LABELS] ?? v.fuelType, v.fuelCapacity, v.odometer,
        humanize(v.status === "ON_DELIVERY" ? "AVAILABLE" : v.status), day(v.insuranceExpiry), day(v.registrationExpiry),
      ]);
    },
  },

  drivers: {
    label: { one: "driver", many: "drivers" },
    write: "drivers:write",
    read: "drivers:read",
    schema: driverSchema,
    columns: [
      { header: "Full Name", field: "fullName", required: true, description: "As on the licence.", example: "Sunil Patil", aliases: ["Name"] },
      { header: "Email", field: "email", required: true, description: "Must be unique.", example: "sunil.patil@example.in" },
      { header: "Phone", field: "phone", required: true, description: "Indian mobile number.", example: "+91 98220 11223" },
      { header: "Address", field: "address", required: true, description: "Up to 250 characters.", example: "Kothrud, Pune 411038" },
      { header: "License Number", field: "licenseNumber", required: true, description: "e.g. MH12 2019 0045678. Must be unique.", example: "MH12 2019 0045678" },
      { header: "License Expiry", field: "licenseExpiry", required: true, description: "YYYY-MM-DD or DD/MM/YYYY.", example: "2029-08-14" },
      { header: "Joining Date", field: "joiningDate", required: true, description: "YYYY-MM-DD or DD/MM/YYYY.", example: "2024-04-01" },
      { header: "Status", field: "status", required: false, description: "Available (default), Off Duty or Inactive.", example: "Available" },
    ],
    toInput: (r) => ({
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      address: r.address,
      licenseNumber: r.licenseNumber,
      licenseExpiry: readDate("licenseExpiry", r.licenseExpiry),
      joiningDate: readDate("joiningDate", r.joiningDate),
      status: enumValue("status", r.status, ["AVAILABLE", "OFF_DUTY", "INACTIVE"]),
      assignedVehicleId: null,
      // Passwords are never imported from files: create login accounts from the Drivers page.
      loginPassword: undefined,
    }),
    key: (i) => `email:${lower(i.email)}`,
    existing: async (tx, i) => {
      const d = await tx.driver.findFirst({ where: { OR: [{ email: String(i.email) }, { licenseNumber: String(i.licenseNumber) }] } });
      if (d) return d.email === i.email ? `Email already belongs to driver ${d.code}.` : `License number already belongs to driver ${d.code}.`;
      return null;
    },
    insert: (tx, actor, input) => insertDriver(tx, actor, input, { quiet: true }),
    exportRows: async (f) => {
      const rows = await prisma.driver.findMany({
        where: { deletedAt: null, ...ids(f), ...(f.status ? { status: f.status } : {}), ...(f.q ? { OR: [{ fullName: { contains: f.q } }, { email: { contains: f.q } }] } : {}) },
        orderBy: { code: "asc" },
      });
      return rows.map((d) => [d.fullName, d.email, d.phone, d.address, d.licenseNumber, day(d.licenseExpiry), day(d.joiningDate), humanize(d.status === "ON_DELIVERY" ? "AVAILABLE" : d.status)]);
    },
  },

  deliveries: {
    label: { one: "delivery", many: "deliveries" },
    write: "deliveries:write",
    read: "deliveries:read",
    schema: deliverySchema,
    columns: [
      { header: "Customer Name", field: "customerName", required: true, description: "Who receives the goods.", example: "Sharma Electronics", aliases: ["Customer"] },
      { header: "Customer Phone", field: "customerPhone", required: true, description: "Indian mobile number.", example: "+91 98200 12345" },
      { header: "Pickup Address", field: "pickupAddress", required: true, description: "Up to 250 characters.", example: "Hinjewadi Phase 1, Pune", aliases: ["Pickup"] },
      { header: "Pickup Latitude", field: "pickupLat", required: true, description: "Decimal degrees.", example: "18.5913" },
      { header: "Pickup Longitude", field: "pickupLng", required: true, description: "Decimal degrees.", example: "73.7389" },
      { header: "Destination Address", field: "destinationAddress", required: true, description: "Up to 250 characters.", example: "Hadapsar, Pune", aliases: ["Destination"] },
      { header: "Destination Latitude", field: "destLat", required: true, description: "Decimal degrees.", example: "18.5158" },
      { header: "Destination Longitude", field: "destLng", required: true, description: "Decimal degrees.", example: "73.9272" },
      { header: "Scheduled At", field: "scheduledAt", required: true, description: "YYYY-MM-DD HH:MM.", example: "2026-12-01 09:30", aliases: ["Scheduled"] },
      { header: "Expected At", field: "expectedAt", required: true, description: "After the scheduled time.", example: "2026-12-01 13:00", aliases: ["Expected"] },
      { header: "Priority", field: "priority", required: false, description: "Low, Normal (default), High or Urgent.", example: "Normal" },
      { header: "Notes", field: "notes", required: false, description: "Up to 1000 characters.", example: "Call before arrival" },
    ],
    toInput: (r) => ({
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      pickupAddress: r.pickupAddress,
      destinationAddress: r.destinationAddress,
      pickupLat: readNumber("pickupLat", r.pickupLat),
      pickupLng: readNumber("pickupLng", r.pickupLng),
      destLat: readNumber("destLat", r.destLat),
      destLng: readNumber("destLng", r.destLng),
      scheduledAt: readDate("scheduledAt", r.scheduledAt),
      expectedAt: readDate("expectedAt", r.expectedAt),
      priority: enumValue("priority", r.priority, PRIORITIES),
      notes: r.notes || null,
      driverId: null,
      vehicleId: null,
    }),
    key: (i) => `del:${String(i.customerPhone).replace(/\D/g, "").slice(-10)}|${lower(i.destinationAddress)}|${minute(i.scheduledAt)}`,
    existing: async (tx, i) => {
      const d = await tx.delivery.findFirst({
        where: { customerName: String(i.customerName), destinationAddress: String(i.destinationAddress), scheduledAt: i.scheduledAt as Date },
      });
      return d ? `The same delivery already exists as ${d.code}.` : null;
    },
    insert: (tx, actor, input, ctx) => insertPendingDelivery(tx, actor, input, ctx.averageSpeedKmh),
    exportRows: async (f) => {
      const rows = await prisma.delivery.findMany({
        where: { ...ids(f), ...range("scheduledAt", f), ...(f.status ? { status: f.status } : {}), ...(f.q ? { OR: [{ code: { contains: f.q } }, { customerName: { contains: f.q } }] } : {}) },
        orderBy: { scheduledAt: "asc" },
      });
      return rows.map((d) => [
        d.customerName, d.customerPhone, d.pickupAddress, d.pickupLat, d.pickupLng, d.destinationAddress, d.destLat, d.destLng, minute(d.scheduledAt), minute(d.expectedAt),
        humanize(d.priority), d.notes ?? "",
      ]);
    },
  },

  fuel: {
    label: { one: "fuel record", many: "fuel records" },
    write: "fuel:write",
    read: "fuel:read",
    schema: fuelSchema,
    columns: [
      { header: "Vehicle Registration", field: "vehicleId", required: true, description: "Registration number of an existing vehicle.", example: "MH 12 AB 4521", aliases: ["Vehicle"] },
      { header: "Date", field: "date", required: true, description: "YYYY-MM-DD, not in the future.", example: "2026-11-10" },
      { header: "Quantity (L)", field: "quantityL", required: true, description: "Litres (kWh for electric).", example: "42.5" },
      { header: "Price per Litre (INR)", field: "pricePerLitre", required: true, description: "Rupees.", example: "94.20" },
      { header: "Odometer (km)", field: "odometer", required: true, description: "Must fit between earlier and later fills.", example: "18620" },
      { header: "Station", field: "station", required: true, description: "Fuel station name.", example: "HP, Wakad" },
      { header: "Notes", field: "notes", required: false, description: "Optional.", example: "" },
    ],
    toInput: (r, ctx) => ({
      vehicleId: vehicleId("vehicleId", r.vehicleId, ctx),
      date: readDate("date", r.date),
      quantityL: readNumber("quantityL", r.quantityL),
      pricePerLitre: readNumber("pricePerLitre", r.pricePerLitre),
      odometer: readNumber("odometer", r.odometer),
      station: r.station,
      notes: r.notes || null,
    }),
    key: (i) => `fuel:${i.vehicleId}|${day(i.date)}|${i.odometer}`,
    existing: async (tx, i) => {
      const date = i.date as Date;
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const f = await tx.fuelRecord.findFirst({
        where: { vehicleId: String(i.vehicleId), odometer: Number(i.odometer), date: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
      });
      return f ? `The same fill already exists as ${f.code}.` : null;
    },
    insert: (tx, actor, input) => insertFuel(tx, actor, input, { quiet: true }),
    exportRows: async (f) => {
      const rows = await prisma.fuelRecord.findMany({ where: { ...ids(f), ...range("date", f) }, include: { vehicle: { select: { registrationNumber: true } } }, orderBy: { date: "asc" } });
      return rows.map((r) => [r.vehicle.registrationNumber, day(r.date), r.quantityL, rupees(r.pricePerLitrePaise), r.odometer, r.station, r.notes ?? ""]);
    },
  },

  maintenance: {
    label: { one: "maintenance record", many: "maintenance records" },
    write: "maintenance:write",
    read: "maintenance:read",
    schema: maintenanceSchema,
    columns: [
      { header: "Vehicle Registration", field: "vehicleId", required: true, description: "Registration number of an existing vehicle.", example: "MH 12 AB 4521", aliases: ["Vehicle"] },
      { header: "Type", field: "type", required: true, description: Object.values(MAINTENANCE_TYPE_LABELS).join(", "), example: "Oil Change" },
      { header: "Description", field: "description", required: true, description: "What was or will be done.", example: "Engine oil and filter" },
      { header: "Service Date", field: "serviceDate", required: true, description: "YYYY-MM-DD.", example: "2026-10-05" },
      { header: "Status", field: "status", required: false, description: "Scheduled (default), In Progress, Completed or Cancelled.", example: "Completed" },
      { header: "Cost (INR)", field: "cost", required: false, description: "Rupees; 0 if unknown.", example: "3850" },
      { header: "Provider", field: "provider", required: true, description: "Workshop or service centre.", example: "Tata Motors Service, Pimpri" },
      { header: "Odometer (km)", field: "odometer", required: false, description: "Reading at the service.", example: "18000" },
      { header: "Next Service Date", field: "nextServiceDate", required: false, description: "YYYY-MM-DD.", example: "2027-04-05" },
      { header: "Next Service Odometer", field: "nextServiceOdometer", required: false, description: "Kilometres.", example: "28000" },
    ],
    toInput: (r, ctx) => ({
      vehicleId: vehicleId("vehicleId", r.vehicleId, ctx),
      type: enumValue("type", r.type, MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABELS),
      description: r.description,
      serviceDate: readDate("serviceDate", r.serviceDate),
      status: enumValue("status", r.status, MAINTENANCE_STATUSES),
      cost: readNumber("cost", r.cost),
      provider: r.provider,
      odometer: readNumber("odometer", r.odometer) ?? null,
      nextServiceDate: readDate("nextServiceDate", r.nextServiceDate) ?? null,
      nextServiceOdometer: readNumber("nextServiceOdometer", r.nextServiceOdometer) ?? null,
    }),
    key: (i) => `mnt:${i.vehicleId}|${i.type}|${day(i.serviceDate)}`,
    existing: async (tx, i) => {
      const date = i.serviceDate as Date;
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const m = await tx.maintenanceRecord.findFirst({
        where: { vehicleId: String(i.vehicleId), type: String(i.type), serviceDate: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
      });
      return m ? `The same service already exists as ${m.code}.` : null;
    },
    insert: (tx, actor, input) => {
      const i = input as { status: string; serviceDate: Date };
      return insertMaintenance(tx, actor, input, { quiet: true, completedAt: i.status === "COMPLETED" ? i.serviceDate : undefined });
    },
    exportRows: async (f) => {
      const rows = await prisma.maintenanceRecord.findMany({
        where: { ...ids(f), ...range("serviceDate", f), ...(f.status ? { status: f.status } : {}) },
        include: { vehicle: { select: { registrationNumber: true } } },
        orderBy: { serviceDate: "asc" },
      });
      return rows.map((m) => [
        m.vehicle.registrationNumber, MAINTENANCE_TYPE_LABELS[m.type as keyof typeof MAINTENANCE_TYPE_LABELS] ?? m.type, m.description, day(m.serviceDate), humanize(m.status),
        rupees(m.costPaise), m.provider, m.odometer ?? "", day(m.nextServiceDate), m.nextServiceOdometer ?? "",
      ]);
    },
  },
};

export function isImportEntity(value: string): value is ImportEntity {
  return (IMPORT_ENTITIES as readonly string[]).includes(value);
}

function entity(name: string): EntityDef {
  if (!isImportEntity(name)) throw badRequest(`Unknown data type "${name}".`);
  return ENTITIES[name];
}

export function columnsFor(name: string): ColumnSpec[] {
  return entity(name).columns;
}

export function permissionsFor(name: string) {
  const e = entity(name);
  return { read: e.read, write: e.write };
}

// --- Templates and exports ---------------------------------------------------------

export function templateCsv(name: string): { filename: string; csv: string } {
  const e = entity(name);
  return { filename: `logitrack-${name}-template.csv`, csv: toCsv(e.columns.map((c) => c.header), [e.columns.map((c) => c.example)]) };
}

export async function exportCsv(actor: SessionUser, name: string, filters: ExportFilters): Promise<{ filename: string; csv: string; count: number }> {
  const e = entity(name);
  const rows = await e.exportRows(filters);
  await logActivity(prisma, actor, "EXPORT", "Data", null, `Exported ${rows.length} ${rows.length === 1 ? e.label.one : e.label.many} (import format)`);
  return { filename: `logitrack-${name}-${format(new Date(), "yyyyMMdd-HHmm")}.csv`, csv: toCsv(e.columns.map((c) => c.header), rows), count: rows.length };
}

// --- Import ------------------------------------------------------------------------

export type RowStatus = "valid" | "invalid" | "duplicate";

export interface ImportRowResult {
  line: number;
  status: RowStatus;
  /** Column header -> message. "_" for row-level problems. */
  errors: Record<string, string>;
  values: Record<string, string>;
  /** Code the row received (preview: the code it would receive). */
  code?: string | null;
}

export interface ImportResult {
  entity: ImportEntity;
  committed: boolean;
  columns: { header: string; required: boolean }[];
  ignoredColumns: string[];
  rows: ImportRowResult[];
  summary: { total: number; valid: number; invalid: number; duplicate: number; imported: number; skipped: number };
}

/** Thrown inside the transaction to roll a preview back while keeping its results. */
class PreviewRollback extends Error {
  constructor(public result: ImportResult) {
    super("preview");
  }
}

function readFile(e: EntityDef, text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw badRequest(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  let rows: { line: number; cells: string[] }[];
  try {
    rows = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvParseError) throw badRequest(`The file is not valid CSV: ${err.message}`);
    throw err;
  }
  if (rows.length === 0) throw badRequest("The file is empty.");
  const [head, ...body] = rows;
  if (body.length === 0) throw badRequest("The file has a header row but no data rows.");
  if (body.length > MAX_IMPORT_ROWS) throw badRequest(`The file has ${body.length} rows; the limit is ${MAX_IMPORT_ROWS} per import.`);

  // Map headers to columns (case, spaces and punctuation ignored; report-export spellings accepted).
  const index = new Map<string, ColumnSpec>();
  for (const c of e.columns) for (const h of [c.header, c.field, ...(c.aliases ?? [])]) index.set(norm(h), c);
  const mapping: (ColumnSpec | null)[] = head.cells.map((h) => index.get(norm(h)) ?? null);
  const ignoredColumns = head.cells.filter((_h, i) => !mapping[i] && head.cells[i].trim() !== "");
  const seen = new Set<string>();
  for (const c of mapping) {
    if (!c) continue;
    if (seen.has(c.field)) throw badRequest(`The column "${c.header}" appears more than once.`);
    seen.add(c.field);
  }
  const missing = e.columns.filter((c) => c.required && !seen.has(c.field)).map((c) => c.header);
  if (missing.length) {
    throw new ApiError(422, `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected columns.`, "IMPORT_COLUMNS");
  }
  return { mapping, ignoredColumns, body };
}

function messageFor(err: unknown): { field?: string; message: string } {
  if (err instanceof CellError) return { field: err.field, message: err.message };
  if (err instanceof ApiError) {
    const [field, message] = Object.entries(err.fieldErrors ?? {})[0] ?? [];
    return { field, message: message && message !== err.message ? `${err.message} (${message})` : err.message };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { message: `A record with this ${((err.meta?.target as string[]) ?? []).join(", ") || "value"} already exists.` };
  }
  throw err;
}

/**
 * Validates (preview) or imports (commit) a CSV file.
 *
 * Both modes run the same code inside one transaction. Each row runs in a SAVEPOINT
 * so a row that fails a business rule (tank capacity, odometer order, uniqueness...)
 * is reported without affecting the others. A preview always rolls back. A commit
 * rolls back everything when any row is invalid, unless `skipInvalid` is set, in
 * which case only the valid rows are written and the rest are listed as skipped.
 */
export async function runImport(
  actor: SessionUser,
  name: string,
  text: string,
  opts: { commit: boolean; skipInvalid?: boolean; fileName?: string | null },
): Promise<ImportResult> {
  const e = entity(name);
  if (!can(actor.role, e.write)) throw new ApiError(403, "You do not have permission to import this data.", "FORBIDDEN");
  const { mapping, ignoredColumns, body } = readFile(e, text);
  const headerOf = (field: string) => e.columns.find((c) => c.field === field)?.header ?? "_";
  const started = Date.now();
  const settings = await getSettings();

  const work = async (tx: Db): Promise<ImportResult> => {
    const vehiclesByReg = new Map((await tx.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, registrationNumber: true } })).map((v) => [v.registrationNumber, v.id]));
    const ctx: Context = { tx, vehiclesByReg, averageSpeedKmh: settings.averageSpeedKmh };
    const keys = new Map<string, number>();
    const rows: ImportRowResult[] = [];

    for (const row of body) {
      const raw: Record<string, string> = {};
      const values: Record<string, string> = {};
      mapping.forEach((c, i) => {
        if (!c) return;
        const v = unguard((row.cells[i] ?? "").trim());
        raw[c.field] = v;
        values[c.header] = v;
      });
      const result: ImportRowResult = { line: row.line, status: "valid", errors: {}, values };
      rows.push(result);
      if (row.cells.length > mapping.length) result.errors._ = `This row has ${row.cells.length} values but the header has ${mapping.length} columns.`;

      let input: Record<string, unknown> | null = null;
      try {
        const parsed = e.schema.safeParse(e.toInput(raw, ctx));
        if (parsed.success) input = parsed.data as Record<string, unknown>;
        else for (const issue of parsed.error.issues) result.errors[headerOf(String(issue.path[0] ?? "_"))] ??= issue.message;
      } catch (err) {
        const { field, message } = messageFor(err);
        result.errors[field ? headerOf(field) : "_"] = message;
      }
      if (Object.keys(result.errors).length || !input) {
        result.status = "invalid";
        continue;
      }

      const key = e.key(input);
      const earlier = keys.get(key);
      if (earlier !== undefined) {
        result.status = "duplicate";
        result.errors._ = `Same as line ${earlier} of this file.`;
        continue;
      }
      keys.set(key, row.line);
      const clash = await e.existing(tx, input);
      if (clash) {
        result.status = "duplicate";
        result.errors._ = clash;
        continue;
      }

      await tx.$executeRawUnsafe("SAVEPOINT import_row");
      try {
        const created = await e.insert(tx, actor, input as never, ctx);
        result.code = created.code ?? null;
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row");
        if ("registrationNumber" in input && created.id) vehiclesByReg.set(String(input.registrationNumber), created.id);
      } catch (err) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_row");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row");
        const { field, message } = messageFor(err);
        result.status = "invalid";
        result.errors[field ? headerOf(field) : "_"] = message;
      }
    }

    const valid = rows.filter((r) => r.status === "valid").length;
    const invalid = rows.filter((r) => r.status === "invalid").length;
    const duplicate = rows.filter((r) => r.status === "duplicate").length;
    const rejected = invalid + duplicate > 0 && !opts.skipInvalid;
    const imported = opts.commit && !rejected ? valid : 0;
    const result: ImportResult = {
      entity: name as ImportEntity,
      committed: opts.commit && !rejected && valid > 0,
      columns: e.columns.map((c) => ({ header: c.header, required: c.required })),
      ignoredColumns,
      rows,
      summary: { total: rows.length, valid, invalid, duplicate, imported, skipped: imported ? invalid + duplicate : 0 },
    };
    if (!opts.commit || rejected || valid === 0) throw new PreviewRollback(result);

    await logActivity(
      tx, actor, "CREATE", "Import", null,
      `Imported ${valid} ${valid === 1 ? e.label.one : e.label.many} from ${opts.fileName ? `"${opts.fileName.slice(0, 80)}"` : "a CSV file"}${result.summary.skipped ? ` (${result.summary.skipped} rows skipped)` : ""}`,
    );
    return result;
  };

  try {
    const result = await prisma.$transaction((tx) => work(tx), { maxWait: 10_000, timeout: 120_000 });
    log.info("import.committed", { entity: name, rows: result.summary.total, imported: result.summary.imported, skipped: result.summary.skipped, userId: actor.id, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    if (!(err instanceof PreviewRollback)) {
      log.error("import.failed", { entity: name, userId: actor.id, err });
      throw err;
    }
    const r = err.result;
    if (opts.commit) {
      log.warn("import.rejected", { entity: name, rows: r.summary.total, invalid: r.summary.invalid, duplicate: r.summary.duplicate, userId: actor.id });
    }
    return r;
  }
}
