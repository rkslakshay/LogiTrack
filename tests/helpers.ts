import type { SessionUser } from "@/lib/auth";
import type { Role } from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { DeliveryInput, DriverInput, VehicleInput } from "@/lib/validation";
import { clearSettingsCache } from "@/server/services/settings";

let counter = 0;
const next = () => ++counter;

/** Empties every table so each test file starts from a known state. */
export async function resetDb() {
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
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.counter.deleteMany();
  clearSettingsCache();
}

export async function makeUser(role: Role, overrides: { driverId?: string | null } = {}): Promise<SessionUser> {
  const n = next();
  const user = await prisma.user.create({
    data: { name: `${role} ${n}`, email: `user${n}@test.in`, role, passwordHash: "not-a-real-hash" },
  });
  return { id: user.id, name: user.name, email: user.email, phone: null, role, driverId: overrides.driverId ?? null };
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export function vehicleInput(overrides: Partial<VehicleInput> = {}): VehicleInput {
  const n = next();
  return {
    registrationNumber: `MH 12 AB ${String(1000 + n)}`,
    name: `Test Vehicle ${n}`,
    type: "VAN",
    manufacturer: "Tata",
    model: "Winger",
    year: 2022,
    fuelType: "DIESEL",
    fuelCapacity: 60,
    odometer: 10_000,
    status: "AVAILABLE",
    insuranceExpiry: days(200),
    registrationExpiry: days(900),
    assignedDriverId: null,
    lastLat: 18.52,
    lastLng: 73.85,
    ...overrides,
  };
}

export function driverInput(overrides: Partial<DriverInput> = {}): DriverInput {
  const n = next();
  return {
    fullName: `Test Driver ${n}`,
    email: `driver${n}@test.in`,
    phone: "+91 98765 43210",
    address: "Test Street, Pune 411001",
    licenseNumber: `MH12 2020 ${String(1_000_000 + n)}`,
    licenseExpiry: days(500),
    joiningDate: days(-400),
    status: "AVAILABLE",
    assignedVehicleId: null,
    loginPassword: undefined,
    ...overrides,
  };
}

export function deliveryInput(overrides: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    customerName: "Sharma Electronics",
    customerPhone: "+91 98200 12345",
    pickupAddress: "Hinjewadi, Pune",
    destinationAddress: "Hadapsar, Pune",
    pickupLat: 18.5913,
    pickupLng: 73.7389,
    destLat: 18.5158,
    destLng: 73.9272,
    scheduledAt: days(0),
    expectedAt: days(1),
    priority: "NORMAL",
    notes: null,
    driverId: null,
    vehicleId: null,
    ...overrides,
  };
}

export { prisma };
