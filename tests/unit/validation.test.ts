import { describe, expect, it } from "vitest";
import {
  changePasswordSchema, deliverySchema, driverSchema, fuelSchema, loginSchema, maintenanceSchema, password, phone, registrationNumber, vehicleSchema,
} from "@/lib/validation";
import { deliveryInput, driverInput, vehicleInput } from "../helpers";

const errorsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("Indian formats", () => {
  it("accepts and normalises registration numbers", () => {
    expect(registrationNumber.parse("mh12ab1234")).toBe("MH12AB1234");
    expect(registrationNumber.parse("MH 12 AB 1234")).toBe("MH 12 AB 1234");
    expect(registrationNumber.parse("dl-1c-aa-1234")).toBe("DL 1C AA 1234");
    expect(registrationNumber.parse("22 BH 1234 AA")).toBe("22 BH 1234 AA");
  });

  it("rejects malformed registration numbers", () => {
    for (const bad of ["", "ABC", "MH 12 1234", "12 MH AB 1234", "MH 12 AB 12345"]) {
      expect(registrationNumber.safeParse(bad).success).toBe(false);
    }
  });

  it("validates Indian mobile numbers", () => {
    for (const ok of ["9876543210", "+91 98765 43210", "+919876543210", "98765 43210", "+91-9876543210"]) {
      expect(phone.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["12345", "5876543210", "+1 415 555 0100", "98765432101", "phone"]) {
      expect(phone.safeParse(bad).success).toBe(false);
    }
  });
});

describe("password policy", () => {
  it("requires length, a letter and a number", () => {
    expect(password.safeParse("Admin@123").success).toBe(true);
    expect(password.safeParse("short1").success).toBe(false);
    expect(password.safeParse("onlyletters").success).toBe(false);
    expect(password.safeParse("12345678").success).toBe(false);
  });

  it("checks confirmation and that the password actually changes", () => {
    const base = { currentPassword: "Old@1234", newPassword: "New@12345", confirmPassword: "New@12345" };
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
    expect(errorsOf(changePasswordSchema.safeParse({ ...base, confirmPassword: "nope" }))).toHaveProperty("confirmPassword");
    expect(errorsOf(changePasswordSchema.safeParse({ ...base, newPassword: "Old@1234", confirmPassword: "Old@1234" }))).toHaveProperty("newPassword");
  });
});

describe("login", () => {
  it("lower-cases and trims the email", () => {
    expect(loginSchema.parse({ email: "  Admin@LogiTrack.in ", password: "x" }).email).toBe("admin@logitrack.in");
  });
  it("rejects missing fields", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.in", password: "" }).success).toBe(false);
  });
});

describe("vehicle schema", () => {
  it("coerces form strings into typed values", () => {
    const parsed = vehicleSchema.parse({ ...vehicleInput(), year: "2021", fuelCapacity: "60.5", odometer: "12000", insuranceExpiry: "2027-01-31", assignedDriverId: "", lastLat: "", lastLng: "" });
    expect(parsed.year).toBe(2021);
    expect(parsed.fuelCapacity).toBe(60.5);
    expect(parsed.insuranceExpiry).toBeInstanceOf(Date);
    expect(parsed.assignedDriverId).toBeNull();
    expect(parsed.lastLat).toBeNull();
  });

  it("reports helpful field errors", () => {
    const errors = errorsOf(vehicleSchema.safeParse({ ...vehicleInput(), registrationNumber: "bad", year: 1800, odometer: -5, fuelCapacity: 0, type: "SPACESHIP" }));
    expect(errors.registrationNumber).toMatch(/Indian format/);
    expect(errors.year).toMatch(/1990/);
    expect(errors.odometer).toMatch(/negative/);
    expect(errors).toHaveProperty("fuelCapacity");
    expect(errors).toHaveProperty("type");
  });

  it("does not allow setting ON_DELIVERY by hand", () => {
    expect(vehicleSchema.safeParse({ ...vehicleInput(), status: "ON_DELIVERY" }).success).toBe(false);
  });
});

describe("driver schema", () => {
  it("accepts a valid driver and treats an empty password as not provided", () => {
    const parsed = driverSchema.parse({ ...driverInput(), loginPassword: "" });
    expect(parsed.loginPassword).toBeUndefined();
  });
  it("validates licence number and phone", () => {
    const errors = errorsOf(driverSchema.safeParse({ ...driverInput(), licenseNumber: "123", phone: "000" }));
    expect(errors).toHaveProperty("licenseNumber");
    expect(errors).toHaveProperty("phone");
  });
});

describe("delivery schema", () => {
  it("accepts a valid delivery", () => {
    expect(deliverySchema.safeParse(deliveryInput()).success).toBe(true);
  });
  it("requires the expected time to be after the scheduled time", () => {
    const d = deliveryInput();
    expect(errorsOf(deliverySchema.safeParse({ ...d, expectedAt: d.scheduledAt }))).toHaveProperty("expectedAt");
  });
  it("requires different pickup and destination points", () => {
    const d = deliveryInput();
    expect(errorsOf(deliverySchema.safeParse({ ...d, destLat: d.pickupLat, destLng: d.pickupLng }))).toHaveProperty("destinationAddress");
  });
  it("requires a driver and vehicle together", () => {
    expect(errorsOf(deliverySchema.safeParse({ ...deliveryInput(), driverId: "abc" }))).toHaveProperty("vehicleId");
  });
  it("rejects coordinates outside the valid range", () => {
    expect(deliverySchema.safeParse({ ...deliveryInput(), pickupLat: 120 }).success).toBe(false);
    expect(deliverySchema.safeParse({ ...deliveryInput(), destLng: -200 }).success).toBe(false);
  });
});

describe("fuel and maintenance schemas", () => {
  const fuel = { vehicleId: "v1", date: new Date(), quantityL: 40, pricePerLitre: 92.5, odometer: 12000, station: "HP Pump", notes: "" };
  it("validates fuel quantities, prices and dates", () => {
    expect(fuelSchema.safeParse(fuel).success).toBe(true);
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, quantityL: 0 }))).toHaveProperty("quantityL");
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, quantityL: -3 }))).toHaveProperty("quantityL");
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, pricePerLitre: 0 }))).toHaveProperty("pricePerLitre");
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, odometer: -1 }))).toHaveProperty("odometer");
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, date: new Date(Date.now() + 5 * 86_400_000) }))).toHaveProperty("date");
    expect(errorsOf(fuelSchema.safeParse({ ...fuel, vehicleId: "" }))).toHaveProperty("vehicleId");
  });

  it("treats blank optional maintenance fields as null", () => {
    const parsed = maintenanceSchema.parse({
      vehicleId: "v1", type: "OIL_CHANGE", description: "Oil change", serviceDate: "2026-07-01", provider: "Garage",
      nextServiceDate: "", nextServiceOdometer: "", odometer: "", cost: "2500",
    });
    expect(parsed.nextServiceDate).toBeNull();
    expect(parsed.nextServiceOdometer).toBeNull();
    expect(parsed.cost).toBe(2500);
    expect(parsed.status).toBe("SCHEDULED");
  });
});
