// Generates a reproducible synthetic dataset for performance testing in its OWN database
// file (prisma/perf.db by default). It refuses to run against dev.db or e2e.db, so the
// normal demo data is never overwritten.
//
//   npm run perf:seed            (DATABASE_URL defaults to file:./perf.db)
//
// Volumes: 100 vehicles, 100 drivers, 1,000 deliveries, 5,000 delivery events,
// 2,000 fuel records, 1,000 maintenance records. All data is fictional.
process.env.DATABASE_URL ??= "file:./perf.db";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { localRoute } from "../src/lib/routing";

const url = process.env.DATABASE_URL!;
if (!/perf[^/\\]*\.db$/.test(url)) {
  console.error(`Refusing to seed ${url}: the performance dataset only goes into a file named perf*.db.`);
  process.exit(1);
}

const N = { vehicles: 100, drivers: 100, deliveries: 1000, events: 5000, fuel: 2000, maintenance: 1000 };

// Deterministic PRNG (mulberry32) so every run produces the same data.
let seed = 20261119;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const DAY = 86_400_000;

const HUBS = [
  { name: "Pune", lat: 18.52, lng: 73.86, rto: "MH 12" },
  { name: "Mumbai", lat: 19.08, lng: 72.88, rto: "MH 01" },
  { name: "Bengaluru", lat: 12.97, lng: 77.59, rto: "KA 01" },
  { name: "Delhi", lat: 28.61, lng: 77.21, rto: "DL 01" },
  { name: "Chennai", lat: 13.08, lng: 80.27, rto: "TN 01" },
];
const FIRST = ["Aarav", "Vivaan", "Aditya", "Sai", "Arjun", "Ishaan", "Kabir", "Ravi", "Suresh", "Anita", "Meera", "Kavya", "Pooja", "Neha", "Rahul", "Imran", "Farhan", "Gurpreet", "Lakshmi", "Deepak"];
const LAST = ["Sharma", "Patil", "Iyer", "Reddy", "Khan", "Singh", "Nair", "Gupta", "Joshi", "Kulkarni", "Das", "Menon", "Yadav", "Bose", "Shetty"];
const TYPES = ["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "BIKE", "CONTAINER"] as const;
const MTYPES = ["GENERAL_SERVICE", "OIL_CHANGE", "TYRE", "BRAKE", "ENGINE", "BATTERY", "INSPECTION", "REPAIR"] as const;

async function main() {
  const dbFile = resolve(process.cwd(), "prisma", url.replace(/^file:\.?\/?/, ""));
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${dbFile}${suffix}`, { force: true });
  execSync("npx prisma migrate deploy", { env: process.env, stdio: "pipe" });
  const { prisma } = await import("../src/lib/db");
  const started = Date.now();
  const now = Date.now();

  const accounts = [
    { name: "Perf Admin", email: "admin@logitrack.in", role: "SUPER_ADMIN", password: "Admin@123" },
    { name: "Perf Manager", email: "manager@logitrack.in", role: "FLEET_MANAGER", password: "Manager@123" },
    { name: "Perf Dispatcher", email: "dispatcher@logitrack.in", role: "DISPATCHER", password: "Dispatch@123" },
  ];
  const users = [];
  for (const a of accounts) {
    users.push(await prisma.user.create({ data: { name: a.name, email: a.email, role: a.role, passwordHash: await bcrypt.hash(a.password, 10) } }));
  }
  const driverHash = await bcrypt.hash("Driver@123", 10);

  // Drivers (the first one has a login, driver@logitrack.in).
  const drivers = [];
  for (let i = 0; i < N.drivers; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const user = i === 0 ? await prisma.user.create({ data: { name, email: "driver@logitrack.in", role: "DRIVER", passwordHash: driverHash } }) : null;
    drivers.push(
      await prisma.driver.create({
        data: {
          code: `DRV-${String(i + 1).padStart(4, "0")}`, userId: user?.id, fullName: name, email: `perf.driver${i + 1}@example.in`,
          phone: `+91 9${String(800000000 + i).slice(0, 9)}`, address: `${pick(HUBS).name}, India`, licenseNumber: `MH12 2015 ${String(1_000_000 + i)}`,
          licenseExpiry: new Date(now + int(-30, 1500) * DAY), joiningDate: new Date(now - int(100, 2000) * DAY),
        },
      }),
    );
  }

  const vehicles = [];
  for (let i = 0; i < N.vehicles; i++) {
    const hub = HUBS[i % HUBS.length];
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          code: `VEH-${String(i + 1).padStart(4, "0")}`, registrationNumber: `${hub.rto} PF ${String(1000 + i)}`, name: `${hub.name} ${pick(TYPES)} ${i + 1}`,
          type: pick(TYPES), manufacturer: pick(["Tata", "Ashok Leyland", "Mahindra", "Eicher"]), model: "Synthetic", year: int(2015, 2025),
          fuelType: pick(["DIESEL", "DIESEL", "CNG", "PETROL"]), fuelCapacity: int(40, 300), odometer: int(5000, 200000),
          insuranceExpiry: new Date(now + int(-20, 700) * DAY), registrationExpiry: new Date(now + int(100, 4000) * DAY),
          assignedDriverId: drivers[i].id, lastLat: hub.lat + (rand() - 0.5) * 0.2, lastLng: hub.lng + (rand() - 0.5) * 0.2, lastLocationAt: new Date(now),
        },
      }),
    );
  }

  // Deliveries across the last 180 days; the 40 most recent are on the road.
  const STATUSES = ["DELIVERED", "DELIVERED", "DELIVERED", "DELIVERED", "DELIVERED", "DELIVERED", "FAILED", "CANCELLED", "PENDING", "ASSIGNED"];
  const deliveries = [];
  for (let i = 0; i < N.deliveries; i++) {
    const v = vehicles[i % N.vehicles];
    const hub = HUBS[(i % N.vehicles) % HUBS.length];
    const live = i >= N.deliveries - 40;
    const status = live ? "IN_TRANSIT" : pick(STATUSES);
    const scheduledAt = new Date(live ? now - 3_600_000 : now - int(1, 180) * DAY);
    const p = [hub.lat + (rand() - 0.5) * 0.3, hub.lng + (rand() - 0.5) * 0.3] as [number, number];
    const d = [hub.lat + (rand() - 0.5) * 0.3, hub.lng + (rand() - 0.5) * 0.3] as [number, number];
    const route = localRoute([p, d]);
    const assigned = status !== "PENDING";
    const expectedAt = new Date(scheduledAt.getTime() + int(2, 8) * 3_600_000);
    const deliveredAt = status === "DELIVERED" ? new Date(expectedAt.getTime() + int(-90, 60) * 60_000) : null;
    deliveries.push({
      code: `DEL-${String(i + 1).padStart(4, "0")}`, customerName: `${pick(LAST)} ${pick(["Traders", "Electronics", "Pharma", "Foods", "Textiles"])}`,
      customerPhone: `+91 98${String(20000000 + i).slice(0, 8)}`, pickupAddress: `${hub.name} warehouse ${int(1, 9)}`, destinationAddress: `${hub.name} customer ${i + 1}`,
      pickupLat: p[0], pickupLng: p[1], destLat: d[0], destLng: d[1], driverId: assigned ? drivers[i % N.drivers].id : null, vehicleId: assigned ? v.id : null,
      scheduledAt, expectedAt, pickedUpAt: ["DELIVERED", "IN_TRANSIT", "FAILED"].includes(status) ? new Date(scheduledAt.getTime() + 1_800_000) : null,
      deliveredAt, closedAt: ["DELIVERED", "FAILED", "CANCELLED"].includes(status) ? (deliveredAt ?? expectedAt) : null,
      distanceKm: route.distanceKm, estimatedMinutes: Math.round((route.distanceKm / 40) * 60), priority: pick(["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"]),
      status, progress: live ? rand() * 0.5 : status === "DELIVERED" ? 1 : 0, routeGeometry: JSON.stringify(route.geometry), geometrySource: "local", createdById: users[2].id,
      createdAt: scheduledAt,
    });
  }
  await prisma.delivery.createMany({ data: deliveries });
  const liveVehicles = new Set(deliveries.filter((d) => d.status === "IN_TRANSIT").map((d) => d.vehicleId!));
  await prisma.vehicle.updateMany({ where: { id: { in: [...liveVehicles] } }, data: { status: "ON_DELIVERY" } });
  const ids = (await prisma.delivery.findMany({ select: { id: true, scheduledAt: true, status: true }, orderBy: { code: "asc" } }));

  // Exactly 5 events per delivery.
  const steps = ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"];
  const events = [];
  for (const d of ids) {
    for (let k = 0; k < N.events / N.deliveries; k++) {
      const status = k < 4 ? steps[k] : d.status;
      events.push({ deliveryId: d.id, type: k === 0 ? "CREATED" : "STATUS_CHANGE", status, userId: users[2].id, createdAt: new Date(d.scheduledAt.getTime() + k * 1_200_000) });
    }
  }
  for (let i = 0; i < events.length; i += 1000) await prisma.deliveryEvent.createMany({ data: events.slice(i, i + 1000) });

  // Fuel: 20 fills per vehicle with increasing odometer.
  const fuel = [];
  for (let i = 0; i < N.fuel; i++) {
    const v = vehicles[i % N.vehicles];
    const k = Math.floor(i / N.vehicles);
    const qty = Math.round(v.fuelCapacity * (0.4 + rand() * 0.5) * 10) / 10;
    const price = int(8800, 10500);
    fuel.push({
      code: `FUEL-${String(i + 1).padStart(5, "0")}`, vehicleId: v.id, date: new Date(now - (N.fuel / N.vehicles - k) * 9 * DAY), quantityL: qty, pricePerLitrePaise: price,
      totalCostPaise: Math.round(qty * price), odometer: v.odometer - (N.fuel / N.vehicles - k) * 450, station: pick(["HP", "IOCL", "BPCL", "Shell"]), createdById: users[1].id,
    });
  }
  await prisma.fuelRecord.createMany({ data: fuel });

  const maint = [];
  for (let i = 0; i < N.maintenance; i++) {
    const v = vehicles[i % N.vehicles];
    const done = i < N.maintenance - 60;
    const serviceDate = new Date(now + (done ? -int(1, 360) : int(1, 60)) * DAY);
    maint.push({
      code: `MNT-${String(i + 1).padStart(5, "0")}`, vehicleId: v.id, type: pick(MTYPES), description: "Synthetic service record", serviceDate,
      nextServiceDate: new Date(serviceDate.getTime() + 180 * DAY), costPaise: done ? int(50_000, 2_500_000) : 0, provider: "Synthetic Workshop",
      status: done ? "COMPLETED" : "SCHEDULED", completedAt: done ? serviceDate : null, odometer: v.odometer - int(1000, 20000),
    });
  }
  await prisma.maintenanceRecord.createMany({ data: maint });

  for (const [name, value] of [["vehicle", N.vehicles], ["driver", N.drivers], ["delivery", N.deliveries], ["fuel", N.fuel], ["maintenance", N.maintenance]] as const) {
    await prisma.counter.create({ data: { name, value } });
  }
  const counts = {
    vehicles: await prisma.vehicle.count(), drivers: await prisma.driver.count(), deliveries: await prisma.delivery.count(), events: await prisma.deliveryEvent.count(),
    fuel: await prisma.fuelRecord.count(), maintenance: await prisma.maintenanceRecord.count(),
  };
  console.log(`Seeded ${url} in ${((Date.now() - started) / 1000).toFixed(1)} s:`, counts);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
