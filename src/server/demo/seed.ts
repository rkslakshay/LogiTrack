import { addDays, addHours, addMinutes, subDays } from "date-fns";
import type { Driver, Vehicle } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fuelTotalPaise } from "@/lib/domain/fuel";
import { estimateMinutes, pointAlong, type LatLng } from "@/lib/geo";
import { PLACES, placeLabel, type Place } from "@/lib/locations";
import { localRoute } from "@/lib/routing";
import { runReminderSweep } from "@/server/services/reminders";
import { clearSettingsCache } from "@/server/services/settings";

/**
 * Demo data for LogiTrack. Everything is generated relative to "now" so the
 * dashboards, reminders and live map always look current after a reset.
 * A fixed-seed PRNG keeps the dataset reproducible: every reset produces the
 * same fleet, the same people and the same scenarios.
 *
 * Used by the CLI (`npm run db:seed`) and by the in-app "Reset demo data" action.
 * Demo login accounts keep their IDs across resets, so whoever triggers a reset
 * stays signed in.
 */

// --- Deterministic randomness -------------------------------------------------
const PRNG_SEED = 20261115;
let seed = PRNG_SEED;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

let now = new Date();
const place = (id: string): Place => {
  const found = PLACES.find((x) => x.id === id);
  if (!found) throw new Error(`Unknown place ${id}`);
  return found;
};
const REGION: Record<string, string[]> = {
  del: ["del-", "ggn-", "noi-", "fbd-", "gzb-"],
  mum: ["mum-"],
  pun: ["pun-"],
  blr: ["blr-"],
  hyd: ["hyd-"],
  maa: ["maa-"],
};
const placesIn = (region: string) => PLACES.filter((x) => REGION[region].some((prefix) => x.id.startsWith(prefix)));

// --- Reference data -----------------------------------------------------------

const DEMO_USERS = [
  { name: "Aarav Mehta", email: "admin@logitrack.in", phone: "+91 98200 11001", role: "SUPER_ADMIN", password: "Admin@123" },
  { name: "Priya Nair", email: "manager@logitrack.in", phone: "+91 98200 11002", role: "FLEET_MANAGER", password: "Manager@123" },
  { name: "Rohan Verma", email: "dispatcher@logitrack.in", phone: "+91 98200 11003", role: "DISPATCHER", password: "Dispatch@123" },
  { name: "Sneha Kulkarni", email: "sneha.kulkarni@logitrack.in", phone: "+91 98200 11004", role: "DISPATCHER", password: "Dispatch@123" },
] as const;
const DRIVER_PASSWORD = "Driver@123";

const DRIVERS = [
  { name: "Suresh Yadav", region: "mum", email: "driver@logitrack.in", address: "Sakinaka, Andheri East, Mumbai 400072", lic: "MH02 2015 0034512", login: true, skill: 0.93 },
  { name: "Harpreet Singh", region: "del", email: "harpreet.singh@logitrack.in", address: "Tilak Nagar, New Delhi 110018", lic: "DL04 2012 0098231", login: true, skill: 0.9 },
  { name: "Manjunath Gowda", region: "blr", email: "manjunath.gowda@logitrack.in", address: "Rajajinagar, Bengaluru 560010", lic: "KA02 2016 0045127", login: true, skill: 0.88 },
  { name: "Venkatesh Reddy", region: "hyd", email: "venkatesh.reddy@logitrack.in", address: "Kukatpally, Hyderabad 500072", lic: "TS07 2014 0067345", login: false, skill: 0.8 },
  { name: "Karthik Subramanian", region: "maa", email: "karthik.s@logitrack.in", address: "Velachery, Chennai 600042", lic: "TN09 2017 0023876", login: false, skill: 0.85 },
  { name: "Ganesh Shinde", region: "pun", email: "ganesh.shinde@logitrack.in", address: "Wakad, Pune 411057", lic: "MH12 2013 0078123", login: false, skill: 0.76 },
  { name: "Rajesh Kumar", region: "del", email: "rajesh.kumar@logitrack.in", address: "Laxmi Nagar, Delhi 110092", lic: "DL07 2011 0054389", login: false, skill: 0.7 },
  { name: "Imran Shaikh", region: "mum", email: "imran.shaikh@logitrack.in", address: "Kurla West, Mumbai 400070", lic: "MH03 2018 0012984", login: false, skill: 0.82 },
  { name: "Dinesh Chauhan", region: "del", email: "dinesh.chauhan@logitrack.in", address: "Sector 14, Gurugram 122001", lic: "HR26 2015 0087654", login: false, skill: 0.87 },
  { name: "Ravi Shankar", region: "blr", email: "ravi.shankar@logitrack.in", address: "BTM Layout, Bengaluru 560076", lic: "KA05 2019 0031245", login: false, skill: 0.74 },
  { name: "Prakash Joshi", region: "pun", email: "prakash.joshi@logitrack.in", address: "Nigdi, Pimpri-Chinchwad 411044", lic: "MH14 2010 0065432", login: false, skill: 0.91 },
  { name: "Sanjay Mishra", region: "mum", email: "sanjay.mishra@logitrack.in", address: "Kalwa, Thane 400605", lic: "MH04 2016 0044571", login: false, skill: 0.66 },
  { name: "Anil Thakur", region: "hyd", email: "anil.thakur@logitrack.in", address: "Uppal, Hyderabad 500039", lic: "TS09 2018 0019823", login: false, skill: 0.79 },
  { name: "Mohammed Irfan", region: "maa", email: "mohammed.irfan@logitrack.in", address: "Perambur, Chennai 600011", lic: "TN05 2012 0056712", login: false, skill: 0.72 },
] as const;

interface VehicleSeed {
  reg: string; name: string; type: string; make: string; model: string; year: number; fuel: string; capacity: number; odo: number; base: string; kmpl: number;
}
const VEHICLES: VehicleSeed[] = [
  { reg: "MH 04 KF 4821", name: "Mumbai Linehaul 1", type: "TRUCK", make: "BharatBenz", model: "1617R", year: 2021, fuel: "DIESEL", capacity: 215, odo: 142300, base: "mum-andheri", kmpl: 5.2 },
  { reg: "DL 1L AB 7345", name: "Delhi Linehaul 1", type: "CONTAINER", make: "Tata", model: "Signa 4018.S", year: 2020, fuel: "DIESEL", capacity: 365, odo: 198650, base: "del-okhla", kmpl: 3.9 },
  { reg: "KA 01 MN 2290", name: "Bengaluru City 1", type: "MINI_TRUCK", make: "Tata", model: "Ace Gold Diesel", year: 2022, fuel: "DIESEL", capacity: 30, odo: 48210, base: "blr-peenya", kmpl: 17.5 },
  { reg: "TS 09 UB 6614", name: "Hyderabad City 1", type: "PICKUP", make: "Mahindra", model: "Bolero Pik-Up", year: 2021, fuel: "DIESEL", capacity: 57, odo: 76540, base: "hyd-patancheru", kmpl: 13.2 },
  { reg: "TN 09 CX 3158", name: "Chennai Cargo 1", type: "TRUCK", make: "Ashok Leyland", model: "Ecomet 1615", year: 2019, fuel: "DIESEL", capacity: 185, odo: 221480, base: "maa-guindy", kmpl: 5.6 },
  { reg: "MH 12 QT 9072", name: "Pune City 1", type: "VAN", make: "Tata", model: "Winger Cargo", year: 2022, fuel: "DIESEL", capacity: 60, odo: 54870, base: "pun-hinjewadi", kmpl: 11.8 },
  { reg: "DL 1G CD 5526", name: "Delhi City 1", type: "MINI_TRUCK", make: "Ashok Leyland", model: "Dost+", year: 2021, fuel: "DIESEL", capacity: 40, odo: 88320, base: "del-azadpur", kmpl: 15.4 },
  { reg: "MH 43 BX 1187", name: "Mumbai City 1", type: "TRUCK", make: "Eicher", model: "Pro 2049", year: 2022, fuel: "DIESEL", capacity: 60, odo: 67450, base: "mum-bhiwandi", kmpl: 9.8 },
  { reg: "HR 55 AK 8093", name: "Gurugram Express", type: "VAN", make: "Maruti Suzuki", model: "Eeco Cargo CNG", year: 2023, fuel: "CNG", capacity: 65, odo: 31240, base: "ggn-cyber", kmpl: 19.6 },
  { reg: "KA 51 AH 4467", name: "Bengaluru City 2", type: "PICKUP", make: "Isuzu", model: "D-Max S-Cab", year: 2020, fuel: "DIESEL", capacity: 55, odo: 112780, base: "blr-ecity", kmpl: 12.4 },
  { reg: "MH 14 JR 2635", name: "Pune Linehaul 1", type: "TRUCK", make: "Tata", model: "LPT 1109", year: 2018, fuel: "DIESEL", capacity: 160, odo: 256910, base: "pun-chakan", kmpl: 6.8 },
  { reg: "MH 02 FN 7719", name: "Mumbai Courier 1", type: "BIKE", make: "Hero", model: "Splendor+ Cargo", year: 2023, fuel: "PETROL", capacity: 10, odo: 18650, base: "mum-bkc", kmpl: 58 },
  { reg: "TS 08 HK 5503", name: "Hyderabad City 2", type: "MINI_TRUCK", make: "Mahindra", model: "Jeeto Plus", year: 2022, fuel: "DIESEL", capacity: 20, odo: 39870, base: "hyd-secbad", kmpl: 21.5 },
  { reg: "TN 22 DM 6248", name: "Chennai City 1", type: "VAN", make: "Mahindra", model: "Supro Cargo Van", year: 2020, fuel: "DIESEL", capacity: 33, odo: 97430, base: "maa-ambattur", kmpl: 16.8 },
  { reg: "DL 1C AF 9914", name: "Delhi Green 1", type: "MINI_TRUCK", make: "Tata", model: "Ace EV", year: 2024, fuel: "ELECTRIC", capacity: 21, odo: 12480, base: "noi-62", kmpl: 0 },
  { reg: "KA 05 MK 3381", name: "Bengaluru Courier 1", type: "BIKE", make: "TVS", model: "XL100 Heavy Duty", year: 2019, fuel: "PETROL", capacity: 4, odo: 61230, base: "blr-koramangala", kmpl: 52 },
];

const CUSTOMERS = [
  "Reliance Retail Ltd", "Flipkart Fulfilment Centre", "BigBasket Distribution", "DMart Ready", "Apollo Pharmacy", "Asian Paints Depot",
  "Amul Distributors", "Croma Electronics", "Decathlon Sports India", "Nykaa Fulfilment", "Godrej Interio", "Haldiram Snacks",
  "Pidilite Industries", "Zepto Dark Store", "Sharma Electronics", "Gupta Traders", "Sri Lakshmi Textiles", "Patel Hardware Stores",
  "Iyer & Sons Stationers", "Bajaj Electricals", "Medplus Health Services", "Fabindia Warehouse", "Titan Company Ltd", "Havells India",
];
const STATIONS: Record<string, string[]> = {
  mum: ["HP Petrol Pump, Andheri-Kurla Road", "Indian Oil, Western Express Highway", "BPCL, Thane-Belapur Road"],
  del: ["Indian Oil, Mathura Road", "BPCL, NH-48 Gurugram", "HP Auto Care, Ring Road", "IGL CNG Station, Sector 29"],
  blr: ["Indian Oil, Tumkur Road", "Shell, Hosur Road", "BPCL, Outer Ring Road"],
  hyd: ["HP Petrol Pump, NH-65 Patancheru", "Indian Oil, Begumpet"],
  maa: ["BPCL, GST Road Guindy", "Indian Oil, Poonamallee High Road"],
  pun: ["Indian Oil, Mumbai-Pune Highway", "HP Petrol Pump, Chakan-Talegaon Road"],
};
const PROVIDERS: Record<string, string[]> = {
  mum: ["Tata Motors Authorised Service, Andheri", "Shree Sai Auto Works, Bhiwandi"],
  del: ["Ashok Leyland Service Point, Okhla", "Balaji Motor Garage, Sahibabad", "Maruti Suzuki Commercial, Gurugram"],
  blr: ["Prerana Motors, Peenya", "Trident Auto Service, Hosur Road"],
  hyd: ["Automotive Mahindra, Kukatpally", "Sri Venkateswara Motors, Uppal"],
  maa: ["TVS Sundaram Motors, Ambattur", "Ashok Leyland Service, Guindy"],
  pun: ["Panchjanya Tata Service, Chakan", "Sehgal Autoriders, Wakad"],
};
const FAILURE_NOTES = ["Customer not available at the delivery address", "Consignment refused: damaged packaging", "Incorrect address, could not locate consignee", "Vehicle breakdown en route"];
const CANCEL_NOTES = ["Cancelled by customer", "Order merged with another consignment", "Stock not ready at pickup"];
const NOTES = ["Fragile: handle with care", "Call consignee 30 minutes before arrival", "Unloading bay 3, security pass required", "Collect signed proof of delivery", null, null, null];

const phoneFor = (i: number) => `+91 ${98100 + ((i * 37) % 890)} ${String(10000 + ((i * 7919) % 89999)).padStart(5, "0")}`;
const regionOf = (v: VehicleSeed) => Object.keys(REGION).find((r) => REGION[r].some((prefix) => v.base.startsWith(prefix)))!;
const fuelPrice = (fuel: string) => (fuel === "DIESEL" ? between(8950, 9480) : fuel === "PETROL" ? between(10350, 10890) : between(7450, 7900));

async function wipe() {
  // Children first.
  await prisma.notification.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.routeStop.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.route.deleteMany();
  await prisma.fuelRecord.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  // Two-factor set-ups, reset links and pending sign-ins from the demo are discarded.
  await prisma.mfaRecoveryCode.deleteMany();
  await prisma.authChallenge.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  // Accounts created during a demo are removed (their sessions cascade); the demo logins are kept.
  await prisma.user.deleteMany({ where: { email: { notIn: DEMO_EMAILS } } });
  await prisma.setting.deleteMany();
  await prisma.counter.deleteMany();
}

/** A visitor may have locked a shared demo account or turned on two-factor: a reset undoes both. */
const ACCOUNT_RESET = {
  failedLoginCount: 0, lockedUntil: null, mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null,
} as const;

export interface SeedSummary {
  users: number; drivers: number; vehicles: number; deliveries: number; fuelRecords: number; maintenanceRecords: number;
  notifications: number; activityEntries: number; seededAt: string;
}

export const DEMO_LOGINS = [
  ...DEMO_USERS.slice(0, 3).map((u) => ({ role: u.role, email: u.email, password: u.password })),
  { role: "DRIVER", email: "driver@logitrack.in", password: DRIVER_PASSWORD },
] as const;

const DEMO_EMAILS: string[] = [...DEMO_USERS.map((u) => u.email), ...DRIVERS.filter((d) => d.login).map((d) => d.email)];

/** Wipes operational data and rebuilds the demo dataset. */
export async function seedDemoData(): Promise<SeedSummary> {
  seed = PRNG_SEED;
  now = new Date();
  await wipe();

  // --- Users -----------------------------------------------------------------
  const users: Record<string, { id: string }> = {};
  for (const u of DEMO_USERS) {
    const { password, ...data } = u;
    const passwordHash = await hashPassword(password);
    users[u.role === "DISPATCHER" && users.DISPATCHER ? "DISPATCHER2" : u.role] = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...data, passwordHash, createdAt: subDays(now, 210) },
      // Restore anything a demo visitor may have changed.
      update: { ...data, passwordHash, isActive: true, ...ACCOUNT_RESET },
    });
  }
  const admin = users.SUPER_ADMIN;
  const manager = users.FLEET_MANAGER;
  const dispatcher = users.DISPATCHER;
  const driverHash = await hashPassword(DRIVER_PASSWORD);

  const activity: { userId: string | null; action: string; entityType: string; entityId: string | null; description: string; createdAt: Date }[] = [];
  const log = (userId: string | null, action: string, entityType: string, entityId: string | null, description: string, createdAt: Date) =>
    activity.push({ userId, action, entityType, entityId, description, createdAt });

  // --- Drivers ---------------------------------------------------------------
  const drivers: (Driver & { seed: (typeof DRIVERS)[number] })[] = [];
  for (let i = 0; i < DRIVERS.length; i++) {
    const d = DRIVERS[i];
    const phone = phoneFor(i + 1);
    const joined = subDays(now, int(220, 1500));
    let userId: string | null = null;
    if (d.login) {
      const user = await prisma.user.upsert({
        where: { email: d.email },
        create: { name: d.name, email: d.email, phone, role: "DRIVER", passwordHash: driverHash, createdAt: subDays(now, 200) },
        update: { name: d.name, phone, role: "DRIVER", passwordHash: driverHash, isActive: true, ...ACCOUNT_RESET },
      });
      userId = user.id;
    }
    // Driver 9 has a licence about to expire; everyone else is comfortably valid.
    const licenseExpiry = i === 9 ? addDays(now, 18) : addDays(now, int(200, 1600));
    const driver = await prisma.driver.create({
      data: {
        code: `DRV-${String(i + 1).padStart(4, "0")}`, userId, fullName: d.name, email: d.email, phone, address: d.address,
        licenseNumber: d.lic, licenseExpiry, joiningDate: joined, createdAt: subDays(now, 200 - i),
        status: i === 12 ? "OFF_DUTY" : i === 13 ? "INACTIVE" : "AVAILABLE",
      },
    });
    drivers.push({ ...driver, seed: d });
    log(manager.id, "CREATE", "Driver", driver.id, `Added driver ${d.name} (${driver.code})`, subDays(now, 200 - i));
  }

  // --- Vehicles --------------------------------------------------------------
  const vehicles: (Vehicle & { seed: VehicleSeed; region: string })[] = [];
  for (let i = 0; i < VEHICLES.length; i++) {
    const v = VEHICLES[i];
    const base = place(v.base);
    const insuranceExpiry = i === 10 ? addDays(now, 9) : i === 14 ? subDays(now, 5) : addDays(now, int(60, 330));
    const registrationExpiry = i === 3 ? addDays(now, 25) : addDays(now, int(400, 3000));
    const vehicle = await prisma.vehicle.create({
      data: {
        code: `VEH-${String(i + 1).padStart(4, "0")}`, registrationNumber: v.reg, name: v.name, type: v.type, manufacturer: v.make, model: v.model,
        year: v.year, fuelType: v.fuel, fuelCapacity: v.capacity, odometer: v.odo, insuranceExpiry, registrationExpiry,
        status: i === 13 ? "MAINTENANCE" : i === 15 ? "INACTIVE" : "AVAILABLE",
        // Vehicles 0-12 are paired with drivers 0-12; 13-15 are unassigned.
        assignedDriverId: i <= 12 ? drivers[i].id : null,
        lastLat: base.lat, lastLng: base.lng, lastHeading: 0, lastLocationAt: subDays(now, 0),
        createdAt: subDays(now, 205 - i),
      },
    });
    vehicles.push({ ...vehicle, seed: v, region: regionOf(v) });
    log(manager.id, "CREATE", "Vehicle", vehicle.id, `Added vehicle ${v.reg} (${v.name})`, subDays(now, 205 - i));
    if (i <= 12) log(manager.id, "ASSIGN", "Vehicle", vehicle.id, `Assigned driver ${drivers[i].fullName} to ${v.reg}`, subDays(now, 199 - i));
  }

  // --- Deliveries ------------------------------------------------------------
  let deliveryNo = 0;
  const nextDeliveryCode = () => `DEL-${String(++deliveryNo).padStart(4, "0")}`;

  interface DeliverySpec {
    pair: number | null; from: Place; to: Place; status: string; scheduledAt: Date; priority?: string;
    onTime?: boolean; progress?: number; expectedAt?: Date; note?: string | null; createdBy?: string;
  }

  async function createDelivery(spec: DeliverySpec) {
    const route = localRoute([[spec.from.lat, spec.from.lng], [spec.to.lat, spec.to.lng]]);
    const minutes = estimateMinutes(route.distanceKm, 40);
    const scheduledAt = spec.scheduledAt;
    const createdAt = addHours(scheduledAt, -int(4, 30));
    const expectedAt = spec.expectedAt ?? addMinutes(scheduledAt, minutes + 75);
    const driver = spec.pair != null ? drivers[spec.pair] : null;
    const vehicle = spec.pair != null ? vehicles[spec.pair] : null;
    const creator = spec.createdBy ?? (rand() < 0.7 ? dispatcher.id : users.DISPATCHER2.id);
    const closed = ["DELIVERED", "FAILED", "CANCELLED"].includes(spec.status);

    let pickedUpAt: Date | null = null;
    let deliveredAt: Date | null = null;
    let closedAt: Date | null = null;
    const events: { type: string; status: string; note: string | null; userId: string | null; createdAt: Date }[] = [
      { type: "CREATED", status: "PENDING", note: "Delivery created", userId: creator, createdAt },
    ];
    if (driver && vehicle) {
      events.push({
        type: "ASSIGNMENT", status: "ASSIGNED", note: `Assigned to ${driver.fullName} with ${vehicle.registrationNumber}`,
        userId: creator, createdAt: addMinutes(createdAt, int(5, 90)),
      });
    }
    const pickedUp = ["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(spec.status) || (spec.status === "DELAYED" && (spec.progress ?? 0) > 0);
    if (pickedUp || (spec.status === "FAILED" && rand() < 0.75)) {
      // Active deliveries were picked up recently; historical ones shortly after their scheduled time.
      pickedUpAt = closed ? addMinutes(scheduledAt, int(5, 40)) : addMinutes(now, -int(15, 70));
      events.push({ type: "STATUS_CHANGE", status: "PICKED_UP", note: null, userId: driver?.userId ?? null, createdAt: pickedUpAt });
      if (spec.status !== "PICKED_UP") {
        events.push({ type: "STATUS_CHANGE", status: "IN_TRANSIT", note: null, userId: driver?.userId ?? null, createdAt: addMinutes(pickedUpAt, int(3, 12)) });
      }
    }
    if (spec.status === "DELIVERED") {
      deliveredAt = spec.onTime
        ? new Date(Math.min(+addMinutes(pickedUpAt!, Math.round(minutes * between(0.85, 1.12))), +addMinutes(expectedAt, -int(2, 20))))
        : addMinutes(expectedAt, int(15, 170));
      closedAt = deliveredAt;
      if (!spec.onTime) {
        events.push({ type: "STATUS_CHANGE", status: "DELAYED", note: pick(["Heavy traffic on the highway", "Long queue at the unloading bay", "Diversion due to road work"]), userId: creator, createdAt: addMinutes(expectedAt, 1) });
      }
      events.push({ type: "STATUS_CHANGE", status: "DELIVERED", note: "Delivered and proof of delivery collected", userId: driver?.userId ?? null, createdAt: deliveredAt });
    } else if (spec.status === "FAILED") {
      closedAt = addMinutes(pickedUpAt ?? scheduledAt, int(30, Math.max(45, minutes)));
      events.push({ type: "STATUS_CHANGE", status: "FAILED", note: spec.note ?? pick(FAILURE_NOTES), userId: driver?.userId ?? creator, createdAt: closedAt });
    } else if (spec.status === "CANCELLED") {
      closedAt = addMinutes(createdAt, int(60, 200));
      events.push({ type: "STATUS_CHANGE", status: "CANCELLED", note: spec.note ?? pick(CANCEL_NOTES), userId: creator, createdAt: closedAt });
    } else if (spec.status === "DELAYED") {
      events.push({ type: "STATUS_CHANGE", status: "DELAYED", note: spec.note ?? "Held up in traffic near the toll plaza", userId: creator, createdAt: addMinutes(expectedAt, 1) });
    }

    const code = nextDeliveryCode();
    const customer = pick(CUSTOMERS);
    const delivery = await prisma.delivery.create({
      data: {
        code, customerName: customer, customerPhone: phoneFor(deliveryNo + 40),
        pickupAddress: placeLabel(spec.from), destinationAddress: placeLabel(spec.to),
        pickupLat: spec.from.lat, pickupLng: spec.from.lng, destLat: spec.to.lat, destLng: spec.to.lng,
        driverId: driver?.id ?? null, vehicleId: vehicle?.id ?? null,
        scheduledAt, expectedAt, pickedUpAt, deliveredAt, closedAt,
        distanceKm: route.distanceKm, estimatedMinutes: minutes,
        priority: spec.priority ?? pick(["LOW", "NORMAL", "NORMAL", "NORMAL", "HIGH", "HIGH", "URGENT"]),
        status: spec.status, notes: pick(NOTES),
        progress: spec.status === "DELIVERED" ? 1 : (spec.progress ?? 0),
        // Geometry is only kept for open deliveries; closed ones are redrawn on demand.
        routeGeometry: closed ? null : JSON.stringify(route.geometry), geometrySource: closed ? null : "local",
        createdById: creator, createdAt, updatedAt: closedAt ?? events[events.length - 1].createdAt,
        events: { create: events },
      },
    });

    log(creator, "CREATE", "Delivery", delivery.id, `Created delivery ${code} for ${customer}`, createdAt);
    if (closedAt) log(driver?.userId ?? creator, "STATUS_CHANGE", "Delivery", delivery.id, `${code}: marked ${spec.status.toLowerCase()}`, closedAt);
    return { delivery, route };
  }

  // Historical deliveries: ~5 months of closed work spread across driver/vehicle pairs.
  const history: DeliverySpec[] = [];
  // How busy each driver/vehicle pair is. The spread is deliberate: most of the fleet works steadily,
  // pairs 10 and 11 are rarely used (they surface as under-utilised) and pair 12's driver is part-time.
  const PAIR_WEIGHTS = [10, 10, 9, 8, 8, 7, 7, 6, 5, 5, 0.9, 0.5, 3];
  const weightTotal = PAIR_WEIGHTS.reduce((a, b) => a + b, 0);
  const weightedPair = () => {
    let r = rand() * weightTotal;
    for (let i = 0; i < PAIR_WEIGHTS.length; i++) {
      r -= PAIR_WEIGHTS[i];
      if (r <= 0) return i;
    }
    return 0;
  };
  for (let n = 0; n < 300; n++) {
    const pair = n % 40 === 39 ? 13 : weightedPair();
    const region = pair === 13 ? "maa" : vehicles[pair].region;
    const local = placesIn(region);
    const from = pick(local);
    // Mostly intra-city, with the odd intercity run for the bigger vehicles.
    const intercity = rand() < 0.14 && ["TRUCK", "CONTAINER"].includes(vehicles[Math.min(pair, 12)].seed.type);
    let to = intercity ? pick(PLACES.filter((x) => !local.includes(x))) : pick(local);
    while (to.id === from.id) to = pick(local);
    // The retired pair (13) only has old jobs.
    const daysAgo = pair === 13 ? int(75, 110) : int(2, 110);
    const scheduledAt = addMinutes(addHours(subDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), daysAgo), int(6, 16)), pick([0, 15, 30, 45]));
    const roll = rand();
    const status = roll < 0.86 ? "DELIVERED" : roll < 0.93 ? "FAILED" : "CANCELLED";
    // Punctuality drifts for two drivers so the 30-day trend has something to show:
    // driver 7 has slipped recently, driver 4 has improved.
    const recent = daysAgo <= 30;
    const drift = pair === 6 ? (recent ? -0.3 : 0.08) : pair === 3 ? (recent ? 0.17 : -0.12) : 0;
    history.push({ pair, from, to, status, scheduledAt, onTime: rand() < DRIVERS[pair].skill + drift });
  }
  history.sort((a, b) => +a.scheduledAt - +b.scheduledAt);
  for (const spec of history) {
    // Vehicle 15 (inactive) did driver 13's old jobs before both were retired.
    if (spec.pair === 13) {
      const route = await createDelivery({ ...spec, pair: null });
      await prisma.delivery.update({ where: { id: route.delivery.id }, data: { driverId: drivers[13].id, vehicleId: vehicles[15].id } });
    } else await createDelivery(spec);
  }

  // Live operations: what is on the road right now.
  const live: DeliverySpec[] = [
    { pair: 0, from: place("mum-andheri"), to: place("pun-chakan"), status: "IN_TRANSIT", progress: 0.22, scheduledAt: addHours(now, -2), priority: "HIGH" },
    // Risk showcase: this trip cannot make its window (high risk), the Hyderabad one has almost no buffer (medium risk).
    { pair: 1, from: place("del-okhla"), to: place("jai-sitapura"), status: "IN_TRANSIT", progress: 0.38, scheduledAt: addHours(now, -4), expectedAt: addMinutes(now, 8), priority: "URGENT" },
    { pair: 2, from: place("blr-peenya"), to: place("blr-hosur"), status: "IN_TRANSIT", progress: 0.3, scheduledAt: addHours(now, -1), priority: "NORMAL" },
    { pair: 3, from: place("hyd-patancheru"), to: place("hyd-shamshabad"), status: "IN_TRANSIT", progress: 0.12, scheduledAt: addHours(now, -1), expectedAt: addMinutes(now, 10), priority: "NORMAL" },
    { pair: 4, from: place("maa-guindy"), to: place("maa-sriperumbudur"), status: "PICKED_UP", scheduledAt: addMinutes(now, -40), priority: "HIGH" },
    { pair: 5, from: place("pun-hinjewadi"), to: place("pun-hadapsar"), status: "ASSIGNED", scheduledAt: addHours(now, 1), priority: "NORMAL" },
    { pair: 6, from: place("del-azadpur"), to: place("noi-gn"), status: "DELAYED", progress: 0.55, scheduledAt: addHours(now, -6), expectedAt: addHours(now, -2), priority: "HIGH" },
    { pair: 7, from: place("mum-bhiwandi"), to: place("mum-lowerparel"), status: "ASSIGNED", scheduledAt: addHours(now, 2), priority: "URGENT" },
  ];
  for (const spec of live) {
    const { delivery, route } = await createDelivery({ ...spec, expectedAt: spec.expectedAt ?? addHours(now, 9) });
    const pos = spec.progress ? pointAlong(route.geometry as LatLng[], spec.progress) : { point: [spec.from.lat, spec.from.lng] as LatLng, heading: 0 };
    await prisma.vehicle.update({
      where: { id: vehicles[spec.pair!].id },
      data: { status: "ON_DELIVERY", lastLat: pos.point[0], lastLng: pos.point[1], lastHeading: pos.heading, lastLocationAt: now },
    });
    await prisma.driver.update({ where: { id: drivers[spec.pair!].id }, data: { status: "ON_DELIVERY" } });
    log(dispatcher.id, "ASSIGN", "Delivery", delivery.id, `Assigned ${delivery.code} to ${drivers[spec.pair!].fullName} / ${vehicles[spec.pair!].registrationNumber}`, addMinutes(spec.scheduledAt, -30));
  }

  // Pending work waiting for dispatch.
  const pendingSpecs: DeliverySpec[] = [
    { pair: null, from: place("blr-peenya"), to: place("blr-whitefield"), status: "PENDING", scheduledAt: addHours(now, 4), priority: "HIGH" },
    { pair: null, from: place("blr-yeshwanthpur"), to: place("blr-koramangala"), status: "PENDING", scheduledAt: addHours(now, 4), priority: "NORMAL" },
    { pair: null, from: place("blr-peenya"), to: place("blr-ecity"), status: "PENDING", scheduledAt: addHours(now, 5), priority: "NORMAL" },
    { pair: null, from: place("ggn-manesar"), to: place("del-cp"), status: "PENDING", scheduledAt: addHours(now, 3), priority: "URGENT" },
    // Risk showcase: scheduled start has passed and nobody is assigned.
    { pair: null, from: place("ggn-cyber"), to: place("fbd-nit"), status: "PENDING", scheduledAt: addMinutes(now, -40), priority: "LOW" },
    { pair: null, from: place("mum-jnpt"), to: place("mum-thane"), status: "PENDING", scheduledAt: addDays(now, 1), priority: "NORMAL" },
    { pair: null, from: place("pun-chakan"), to: place("nsk-ambad"), status: "PENDING", scheduledAt: addDays(now, 1), priority: "HIGH" },
    { pair: null, from: place("hyd-secbad"), to: place("hyd-hitec"), status: "PENDING", scheduledAt: addDays(now, 2), priority: "LOW" },
  ];
  const pending = [];
  for (const spec of pendingSpecs) pending.push((await createDelivery({ ...spec, expectedAt: addHours(spec.scheduledAt, 6) })).delivery);

  // --- A saved multi-stop route (planned, not yet assigned) ---------------------
  const hub = place("blr-peenya");
  const routeDeliveries = pending.slice(0, 3);
  const stopPoints = [
    { type: "START", label: placeLabel(hub), lat: hub.lat, lng: hub.lng, deliveryId: null as string | null },
    { type: "PICKUP", label: routeDeliveries[0].pickupAddress, lat: routeDeliveries[0].pickupLat, lng: routeDeliveries[0].pickupLng, deliveryId: routeDeliveries[0].id },
    { type: "PICKUP", label: routeDeliveries[2].pickupAddress, lat: routeDeliveries[2].pickupLat, lng: routeDeliveries[2].pickupLng, deliveryId: routeDeliveries[2].id },
    { type: "PICKUP", label: routeDeliveries[1].pickupAddress, lat: routeDeliveries[1].pickupLat, lng: routeDeliveries[1].pickupLng, deliveryId: routeDeliveries[1].id },
    { type: "DROPOFF", label: routeDeliveries[1].destinationAddress, lat: routeDeliveries[1].destLat, lng: routeDeliveries[1].destLng, deliveryId: routeDeliveries[1].id },
    { type: "DROPOFF", label: routeDeliveries[2].destinationAddress, lat: routeDeliveries[2].destLat, lng: routeDeliveries[2].destLng, deliveryId: routeDeliveries[2].id },
    { type: "DROPOFF", label: routeDeliveries[0].destinationAddress, lat: routeDeliveries[0].destLat, lng: routeDeliveries[0].destLng, deliveryId: routeDeliveries[0].id },
  ];
  let routeKm = 0;
  const stops = stopPoints.map((s, i) => {
    const legKm = i === 0 ? 0 : localRoute([[stopPoints[i - 1].lat, stopPoints[i - 1].lng], [s.lat, s.lng]]).distanceKm;
    routeKm += legKm;
    return { ...s, sequence: i, legKm };
  });
  const savedRoute = await prisma.route.create({
    data: {
      code: "RTE-0001", name: "Bengaluru East & South Run", algorithm: "nearest-neighbor+2opt",
      totalDistanceKm: Math.round(routeKm * 10) / 10, estimatedMinutes: estimateMinutes(routeKm, 40, 6),
      createdById: dispatcher.id, createdAt: addHours(now, -3), stops: { create: stops },
    },
  });
  await prisma.delivery.updateMany({ where: { id: { in: routeDeliveries.map((d) => d.id) } }, data: { routeId: savedRoute.id } });
  log(dispatcher.id, "CREATE", "Route", savedRoute.id, `Planned route RTE-0001 "Bengaluru East & South Run" with 3 deliveries`, addHours(now, -3));

  // --- Fuel records ------------------------------------------------------------
  let fuelNo = 0;
  for (const v of vehicles) {
    if (v.seed.fuel === "ELECTRIC") continue;
    const index = vehicles.indexOf(v);
    const drawn = int(5, 8);
    // Fuel-intelligence showcase: vehicle 13 has a single fill on record (not enough data for mileage).
    const fills = index === 12 ? 1 : drawn;
    const range = v.seed.capacity * v.seed.kmpl;
    // Walk the odometer backwards from today so the latest fill sits just below the current reading.
    const points: { date: Date; odometer: number; litres: number }[] = [];
    let odo = v.seed.odo - int(20, 120);
    let date = subDays(now, int(2, 9));
    for (let f = 0; f < fills; f++) {
      const distance = Math.round(range * between(0.45, 0.8));
      // Fuel-intelligence showcase: vehicle 7 burns ~30% more on its two most recent fills (mileage drop).
      const efficiency = v.seed.kmpl * between(0.93, 1.07) * (index === 6 && f < 2 ? 0.72 : 1);
      const litres = Math.min(v.seed.capacity, Math.round((distance / efficiency) * 10) / 10);
      points.unshift({ date, odometer: odo, litres });
      odo -= distance;
      date = subDays(date, int(12, 26));
    }
    for (const point of points) {
      const price = Math.round(fuelPrice(v.seed.fuel));
      const record = await prisma.fuelRecord.create({
        data: {
          code: `FUEL-${String(++fuelNo).padStart(4, "0")}`, vehicleId: v.id, date: point.date, quantityL: point.litres,
          pricePerLitrePaise: price, totalCostPaise: fuelTotalPaise(point.litres, price), odometer: point.odometer,
          station: pick(STATIONS[v.region]), notes: rand() < 0.15 ? "Tank filled to the brim" : null,
          createdById: manager.id, createdAt: point.date,
        },
      });
      log(manager.id, "CREATE", "FuelRecord", record.id, `Logged ${point.litres} L of fuel for ${v.registrationNumber}`, point.date);
    }
  }

  // --- Maintenance -------------------------------------------------------------
  let maintNo = 0;
  async function maintenance(vIndex: number, data: {
    type: string; description: string; serviceDate: Date; status: string; cost?: number; odometer?: number | null;
    nextServiceDate?: Date | null; nextServiceOdometer?: number | null;
  }) {
    const v = vehicles[vIndex];
    const record = await prisma.maintenanceRecord.create({
      data: {
        code: `MNT-${String(++maintNo).padStart(4, "0")}`, vehicleId: v.id, type: data.type, description: data.description,
        serviceDate: data.serviceDate, status: data.status, costPaise: Math.round((data.cost ?? 0) * 100),
        odometer: data.odometer ?? null, nextServiceDate: data.nextServiceDate ?? null, nextServiceOdometer: data.nextServiceOdometer ?? null,
        provider: pick(PROVIDERS[v.region]), completedAt: data.status === "COMPLETED" ? data.serviceDate : null,
        createdAt: subDays(data.serviceDate, data.status === "COMPLETED" ? 3 : 0) > now ? now : subDays(data.serviceDate, 3),
      },
    });
    log(manager.id, data.status === "COMPLETED" ? "COMPLETE" : "CREATE", "MaintenanceRecord", record.id,
      `${data.status === "COMPLETED" ? "Completed" : "Scheduled"} ${data.type.toLowerCase().replace(/_/g, " ")} for ${v.registrationNumber}`,
      data.status === "COMPLETED" ? data.serviceDate : subDays(now, int(1, 6)));
  }
  // Routine history for most of the fleet.
  const ROUTINE: [string, string, number, number][] = [
    ["GENERAL_SERVICE", "Periodic service: engine oil, oil filter, air filter and full inspection", 6500, 14500],
    ["OIL_CHANGE", "Engine oil and oil filter replaced", 2800, 6200],
    ["TYRE", "Two rear tyres replaced and wheel alignment done", 14000, 38000],
    ["BRAKE", "Brake pads replaced, brake fluid topped up", 3500, 9800],
    ["BATTERY", "Battery replaced under warranty exchange", 4200, 8900],
    ["INSPECTION", "Annual fitness inspection and emission (PUC) check", 900, 2200],
  ];
  for (let i = 0; i < vehicles.length; i++) {
    if (i === 8 || i === 9) continue; // these two get hand-written records below
    const count = int(1, 3);
    for (let m = 0; m < count; m++) {
      // Every vehicle except the new EV has a general service on record; the rest of its history varies.
      const [type, description, min, max] = m === 0 && i !== 14 ? ROUTINE[0] : pick(ROUTINE.slice(i === 14 ? 2 : 0));
      const serviceDate = subDays(now, m === 0 ? int(60, 175) : int(20, 150));
      // About half the jobs had a follow-up booked by the workshop; the others leave the next
      // service to the system's recommendation engine.
      const followUp = rand() < 0.5;
      await maintenance(i, {
        type, description, serviceDate, status: "COMPLETED", cost: int(min, max),
        odometer: vehicles[i].seed.odo - int(800, 9000),
        nextServiceDate: followUp ? addDays(serviceDate, int(170, 260)) : null,
        nextServiceOdometer: followUp ? vehicles[i].seed.odo + int(3000, 9000) : null,
      });
    }
  }
  // Scenarios that drive the reminder engine.
  await maintenance(8, { // follow-up overdue by date
    type: "OIL_CHANGE", description: "Engine oil and oil filter replaced", serviceDate: subDays(now, 126), status: "COMPLETED", cost: 3150,
    odometer: vehicles[8].seed.odo - 6800, nextServiceDate: subDays(now, 6), nextServiceOdometer: vehicles[8].seed.odo + 1200,
  });
  await maintenance(9, { // follow-up due soon by odometer
    type: "GENERAL_SERVICE", description: "20,000 km periodic service with coolant flush", serviceDate: subDays(now, 95), status: "COMPLETED", cost: 11800,
    odometer: vehicles[9].seed.odo - 9700, nextServiceDate: addDays(now, 60), nextServiceOdometer: vehicles[9].seed.odo + 300,
  });
  await maintenance(11, { type: "TYRE", description: "Front tyre replacement and chain adjustment", serviceDate: addDays(now, 3), status: "SCHEDULED" });
  await maintenance(5, { type: "BRAKE", description: "Brake pad replacement: driver reported squealing", serviceDate: subDays(now, 4), status: "SCHEDULED" });
  await maintenance(2, { type: "INSPECTION", description: "Annual fitness certificate renewal inspection", serviceDate: addDays(now, 20), status: "SCHEDULED" });
  await maintenance(13, { type: "ENGINE", description: "Clutch plate replacement and gearbox overhaul", serviceDate: subDays(now, 2), status: "IN_PROGRESS", odometer: vehicles[13].seed.odo });

  // --- Activity log + counters ---------------------------------------------------
  log(admin.id, "UPDATE", "Setting", null, "Updated system settings", subDays(now, 30));
  log(admin.id, "CREATE", "User", users.DISPATCHER2.id, "Created Dispatcher account for Sneha Kulkarni", subDays(now, 120));
  activity.sort((a, b) => +a.createdAt - +b.createdAt);
  await prisma.activityLog.createMany({ data: activity });

  await prisma.counter.createMany({
    data: [
      { name: "vehicle", value: vehicles.length },
      { name: "driver", value: drivers.length },
      { name: "delivery", value: deliveryNo },
      { name: "route", value: 1 },
      { name: "fuel", value: fuelNo },
      { name: "maintenance", value: maintNo },
    ],
  });

  // --- Notifications -------------------------------------------------------------
  const staff = [admin.id, manager.id, dispatcher.id, users.DISPATCHER2.id];
  const recentClosed = await prisma.delivery.findMany({ where: { status: "DELIVERED" }, orderBy: { deliveredAt: "desc" }, take: 4 });
  for (const d of recentClosed) {
    await prisma.notification.createMany({
      data: staff.map((userId) => ({
        userId, category: "DELIVERY", severity: "SUCCESS", title: "Delivery completed",
        message: `${d.code} for ${d.customerName} was delivered.`, entityType: "Delivery", entityId: d.id, isRead: true, createdAt: d.deliveredAt!,
      })),
    });
  }
  const delayed = await prisma.delivery.findFirst({ where: { status: "DELAYED" } });
  if (delayed) {
    await prisma.notification.createMany({
      data: staff.map((userId) => ({
        userId, category: "DELIVERY", severity: "WARNING", title: "Delivery delayed",
        message: `${delayed.code} for ${delayed.customerName} is delayed: held up in traffic near the toll plaza.`,
        entityType: "Delivery", entityId: delayed.id, createdAt: addHours(now, -2),
      })),
    });
  }
  for (const d of drivers.filter((x) => x.userId)) {
    const assigned = await prisma.delivery.findFirst({ where: { driverId: d.id, status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] } } });
    if (assigned) {
      await prisma.notification.create({
        data: {
          userId: d.userId!, category: "DELIVERY", severity: "INFO", title: "New delivery assigned",
          message: `${assigned.code}: ${assigned.pickupAddress} → ${assigned.destinationAddress}.`, entityType: "Delivery", entityId: assigned.id,
          createdAt: addHours(now, -3),
        },
      });
    }
  }
  await prisma.notification.createMany({
    data: [admin.id, manager.id, dispatcher.id].map((userId) => ({
      userId, category: "VEHICLE", severity: "WARNING", title: "Vehicle under maintenance",
      message: `${vehicles[13].registrationNumber} is now under maintenance and unavailable for deliveries.`,
      entityType: "Vehicle", entityId: vehicles[13].id, createdAt: subDays(now, 2),
    })),
  });
  // Maintenance, insurance, registration and licence reminders come from the real reminder engine.
  const sweep = await runReminderSweep(now);

  // Remember when this dataset was generated (shown in the demo banner).
  const seededAt = new Date().toISOString();
  await prisma.setting.create({ data: { key: "demoSeededAt", value: seededAt } });
  clearSettingsCache();

  const counts = await Promise.all([
    prisma.user.count(), prisma.driver.count(), prisma.vehicle.count(), prisma.delivery.count(), prisma.fuelRecord.count(),
    prisma.maintenanceRecord.count(), prisma.notification.count(), prisma.activityLog.count(),
  ]);
  void sweep;
  return {
    users: counts[0], drivers: counts[1], vehicles: counts[2], deliveries: counts[3], fuelRecords: counts[4], maintenanceRecords: counts[5],
    notifications: counts[6], activityEntries: counts[7], seededAt,
  };
}
