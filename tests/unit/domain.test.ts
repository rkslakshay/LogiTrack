import { describe, expect, it } from "vitest";
import { DELIVERY_STATUSES, ROLES, type DeliveryStatus } from "@/lib/constants";
import { csvEscape, toCsv } from "@/lib/csv";
import { allowedTransitions, canTransition, isActive, isTerminal, manualTransitions } from "@/lib/domain/delivery-status";
import { computeFuelStats, fuelTotalPaise, validateOdometer } from "@/lib/domain/fuel";
import { computePerformance, rankByScore, type PerformanceDelivery } from "@/lib/domain/performance";
import { expiryReminder, maintenanceReminder } from "@/lib/domain/reminders";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { can, homeFor, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";

const day = (offset: number, base = new Date("2026-06-15T10:00:00")) => new Date(base.getTime() + offset * 86_400_000);
const NOW = new Date("2026-06-15T10:00:00");

describe("delivery status transitions", () => {
  it("follows the main path", () => {
    const fresh = { pickedUp: false };
    expect(canTransition("PENDING", "ASSIGNED", fresh)).toBe(true);
    expect(canTransition("ASSIGNED", "PICKED_UP", fresh)).toBe(true);
    expect(canTransition("PICKED_UP", "IN_TRANSIT", { pickedUp: true })).toBe(true);
    expect(canTransition("IN_TRANSIT", "DELIVERED", { pickedUp: true })).toBe(true);
  });

  it("rejects skipping steps and going backwards", () => {
    expect(canTransition("PENDING", "PICKED_UP", { pickedUp: false })).toBe(false);
    expect(canTransition("PENDING", "DELIVERED", { pickedUp: false })).toBe(false);
    expect(canTransition("ASSIGNED", "DELIVERED", { pickedUp: false })).toBe(false);
    expect(canTransition("IN_TRANSIT", "PICKED_UP", { pickedUp: true })).toBe(false);
    expect(canTransition("IN_TRANSIT", "CANCELLED", { pickedUp: true })).toBe(false);
  });

  it("treats delivered, failed and cancelled as terminal", () => {
    for (const status of ["DELIVERED", "FAILED", "CANCELLED"] as DeliveryStatus[]) {
      expect(allowedTransitions(status, { pickedUp: true })).toEqual([]);
      expect(isTerminal(status)).toBe(true);
      expect(isActive(status)).toBe(false);
    }
  });

  it("resumes a delayed delivery from where it stopped", () => {
    expect(allowedTransitions("DELAYED", { pickedUp: false })).toEqual(["PICKED_UP", "FAILED", "CANCELLED"]);
    expect(allowedTransitions("DELAYED", { pickedUp: true })).toEqual(["IN_TRANSIT", "DELIVERED", "FAILED"]);
  });

  it("never offers assign/unassign as a manual status and never lets drivers cancel", () => {
    for (const status of DELIVERY_STATUSES) {
      for (const pickedUp of [true, false]) {
        const manual = manualTransitions(status, { pickedUp }, "DISPATCHER");
        expect(manual).not.toContain("ASSIGNED");
        expect(manual).not.toContain("PENDING");
        expect(manualTransitions(status, { pickedUp }, "DRIVER")).not.toContain("CANCELLED");
      }
    }
    expect(manualTransitions("ASSIGNED", { pickedUp: false }, "DISPATCHER")).toContain("CANCELLED");
  });

  it("marks the right statuses as active", () => {
    expect(DELIVERY_STATUSES.filter(isActive)).toEqual(["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"]);
  });
});

describe("fuel calculations", () => {
  const fills = [
    { date: day(0), quantityL: 40, totalCostPaise: 360_000, odometer: 10_000 },
    { date: day(7), quantityL: 50, totalCostPaise: 460_000, odometer: 10_600 },
    { date: day(14), quantityL: 45, totalCostPaise: 410_000, odometer: 11_140 },
  ];

  it("computes totals", () => {
    const s = computeFuelStats(fills);
    expect(s.fillCount).toBe(3);
    expect(s.totalLitres).toBe(135);
    expect(s.totalCostPaise).toBe(1_230_000);
    expect(s.avgPricePerLitrePaise).toBe(Math.round(1_230_000 / 135));
  });

  it("computes mileage fill-to-fill, excluding the first fill", () => {
    const s = computeFuelStats(fills);
    expect(s.distanceKm).toBe(1140);
    expect(s.mileageKmPerL).toBeCloseTo(1140 / 95, 6); // 12 km/L
    expect(s.costPerKmPaise).toBeCloseTo(870_000 / 1140, 6);
  });

  it("is independent of input order", () => {
    expect(computeFuelStats([fills[2], fills[0], fills[1]])).toEqual(computeFuelStats(fills));
  });

  it("returns null efficiency when there is not enough data", () => {
    expect(computeFuelStats([]).mileageKmPerL).toBeNull();
    const single = computeFuelStats([fills[0]]);
    expect(single.mileageKmPerL).toBeNull();
    expect(single.costPerKmPaise).toBeNull();
    expect(single.totalLitres).toBe(40);
  });

  it("rounds the total cost to the nearest paisa", () => {
    expect(fuelTotalPaise(42.5, 9245)).toBe(392_913); // 42.5 L x Rs 92.45
    expect(fuelTotalPaise(10, 10_000)).toBe(100_000);
  });

  it("validates odometer readings against neighbouring fills", () => {
    const others = [
      { date: day(0), odometer: 10_000 },
      { date: day(14), odometer: 11_140 },
    ];
    expect(validateOdometer(10_600, day(7), others)).toBeNull();
    expect(validateOdometer(9_900, day(7), others)).toMatch(/cannot be lower/);
    expect(validateOdometer(11_500, day(7), others)).toMatch(/cannot be higher/);
    expect(validateOdometer(12_000, day(20), others)).toBeNull();
    expect(validateOdometer(500, day(1), [])).toBeNull();
  });
});

describe("driver performance", () => {
  const delivered = (onTime: boolean, km = 20): PerformanceDelivery => ({
    status: "DELIVERED", distanceKm: km, expectedAt: day(0), pickedUpAt: day(-0.1), deliveredAt: onTime ? day(-0.01) : day(0.05),
  });
  const failed: PerformanceDelivery = { status: "FAILED", distanceKm: 20, expectedAt: day(0), pickedUpAt: null, deliveredAt: null };
  const cancelled: PerformanceDelivery = { ...failed, status: "CANCELLED" };

  it("counts outcomes and rates", () => {
    const s = computePerformance([delivered(true), delivered(true), delivered(false), failed, cancelled]);
    expect(s.total).toBe(5);
    expect(s.delivered).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.onTime).toBe(2);
    expect(s.late).toBe(1);
    expect(s.successRate).toBeCloseTo(0.75, 9); // cancelled excluded
    expect(s.onTimeRate).toBeCloseTo(2 / 3, 9);
    expect(s.distanceKm).toBe(60); // delivered work only
  });

  it("applies the documented score formula", () => {
    const s = computePerformance([delivered(true), delivered(true), delivered(false), failed]);
    const expected = 100 * (0.45 * 0.75 + 0.4 * (2 / 3) + 0.15 * (3 / 15));
    expect(s.score).toBeCloseTo(expected, 1);
  });

  it("gives a perfect, experienced driver 100", () => {
    expect(computePerformance(Array.from({ length: 15 }, () => delivered(true))).score).toBe(100);
  });

  it("does not rate drivers with too little history", () => {
    expect(computePerformance([delivered(true), delivered(true)]).score).toBeNull();
    expect(computePerformance([]).score).toBeNull();
    expect(computePerformance([]).successRate).toBeNull();
    expect(computePerformance([cancelled, cancelled, cancelled, cancelled]).score).toBeNull();
  });

  it("treats delivery exactly at the expected time as on time", () => {
    const s = computePerformance([{ status: "DELIVERED", distanceKm: 5, expectedAt: day(0), pickedUpAt: day(-0.1), deliveredAt: day(0) }]);
    expect(s.onTime).toBe(1);
  });

  it("averages pickup-to-delivery duration", () => {
    const s = computePerformance([
      { status: "DELIVERED", distanceKm: 5, expectedAt: day(1), pickedUpAt: new Date("2026-06-15T10:00:00"), deliveredAt: new Date("2026-06-15T11:00:00") },
      { status: "DELIVERED", distanceKm: 5, expectedAt: day(1), pickedUpAt: new Date("2026-06-15T10:00:00"), deliveredAt: new Date("2026-06-15T10:30:00") },
    ]);
    expect(s.avgDurationMin).toBe(45);
  });

  it("ranks by score and keeps unrated drivers last", () => {
    const ranked = rankByScore([
      { name: "unrated", stats: computePerformance([delivered(true)]) },
      { name: "average", stats: computePerformance([delivered(true), delivered(false), failed, delivered(false)]) },
      { name: "best", stats: computePerformance(Array.from({ length: 10 }, () => delivered(true))) },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["best", "average", "unrated"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, null]);
  });
});

describe("maintenance reminders", () => {
  const opts = { now: NOW, days: 7, km: 500 };
  const scheduled = (offset: number) => ({ status: "SCHEDULED", serviceDate: day(offset), nextServiceDate: null, nextServiceOdometer: null });

  it("flags scheduled jobs by service date", () => {
    expect(maintenanceReminder(scheduled(-3), 0, opts).state).toBe("OVERDUE");
    expect(maintenanceReminder(scheduled(0), 0, opts).state).toBe("DUE_SOON");
    expect(maintenanceReminder(scheduled(7), 0, opts).state).toBe("DUE_SOON");
    expect(maintenanceReminder(scheduled(8), 0, opts).state).toBe("OK");
    expect(maintenanceReminder(scheduled(-3), 0, opts).reason).toMatch(/3 days ago/);
  });

  it("ignores cancelled and in-progress jobs", () => {
    expect(maintenanceReminder({ ...scheduled(-30), status: "CANCELLED" }, 0, opts).state).toBe("OK");
    expect(maintenanceReminder({ ...scheduled(-30), status: "IN_PROGRESS" }, 0, opts).state).toBe("OK");
  });

  it("creates follow-up reminders from the next service date", () => {
    const done = (next: number) => ({ status: "COMPLETED", serviceDate: day(-100), nextServiceDate: day(next), nextServiceOdometer: null });
    expect(maintenanceReminder(done(-1), 0, opts).state).toBe("OVERDUE");
    expect(maintenanceReminder(done(5), 0, opts).state).toBe("DUE_SOON");
    expect(maintenanceReminder(done(60), 0, opts).state).toBe("OK");
  });

  it("creates follow-up reminders from the odometer threshold", () => {
    const done = { status: "COMPLETED", serviceDate: day(-100), nextServiceDate: day(90), nextServiceOdometer: 50_000 };
    expect(maintenanceReminder(done, 49_000, opts).state).toBe("OK");
    expect(maintenanceReminder(done, 49_600, opts).state).toBe("DUE_SOON");
    expect(maintenanceReminder(done, 49_600, opts).reason).toMatch(/400 km/);
    expect(maintenanceReminder(done, 50_200, opts).state).toBe("OVERDUE");
  });

  it("uses whichever of date and odometer is worse", () => {
    const done = { status: "COMPLETED", serviceDate: day(-100), nextServiceDate: day(-2), nextServiceOdometer: 90_000 };
    expect(maintenanceReminder(done, 10_000, opts).state).toBe("OVERDUE");
  });

  it("has no reminder for a completed job without follow-up details", () => {
    expect(maintenanceReminder({ status: "COMPLETED", serviceDate: day(-10), nextServiceDate: null, nextServiceOdometer: null }, 0, opts).state).toBe("OK");
  });
});

describe("document expiry reminders", () => {
  const opts = { now: NOW, days: 30 };
  it("classifies expiry dates", () => {
    expect(expiryReminder(day(-1), opts)).toEqual({ state: "OVERDUE", days: -1 });
    expect(expiryReminder(day(0), opts).state).toBe("DUE_SOON");
    expect(expiryReminder(day(30), opts).state).toBe("DUE_SOON");
    expect(expiryReminder(day(31), opts).state).toBe("OK");
  });
});

describe("role permissions", () => {
  it("gives the super admin every staff permission", () => {
    for (const p of PERMISSIONS.filter((x) => !x.endsWith(":own"))) expect(can("SUPER_ADMIN", p)).toBe(true);
  });

  it("restricts administration to the super admin", () => {
    for (const role of ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(can(role, "users:manage")).toBe(false);
      expect(can(role, "settings:manage")).toBe(false);
    }
  });

  it("lets fleet managers manage the fleet but dispatchers only read it", () => {
    expect(can("FLEET_MANAGER", "vehicles:write")).toBe(true);
    expect(can("FLEET_MANAGER", "maintenance:write")).toBe(true);
    expect(can("DISPATCHER", "vehicles:read")).toBe(true);
    expect(can("DISPATCHER", "vehicles:write")).toBe(false);
    expect(can("DISPATCHER", "drivers:write")).toBe(false);
    expect(can("DISPATCHER", "fuel:read")).toBe(false);
    expect(can("DISPATCHER", "deliveries:write")).toBe(true);
    expect(can("DISPATCHER", "routes:write")).toBe(true);
  });

  it("limits drivers to their own work", () => {
    expect(ROLE_PERMISSIONS.DRIVER).toEqual(["deliveries:own", "performance:own", "notifications:read"]);
    expect(can("DRIVER", "deliveries:read")).toBe(false);
    expect(can("DRIVER", "tracking:view")).toBe(false);
    expect(can("DRIVER", "dashboard:view")).toBe(false);
  });

  it("denies unknown roles and sends each role to the right home page", () => {
    expect(can("HACKER", "vehicles:read")).toBe(false);
    expect(can(null, "vehicles:read")).toBe(false);
    expect(homeFor("DRIVER")).toBe("/my-deliveries");
    expect(homeFor("DISPATCHER")).toBe("/dashboard");
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(42)).toBe("42");
  });

  it("neutralises spreadsheet formulas in text but keeps negative numbers", () => {
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+91 98765 43210")).toBe("'+91 98765 43210");
    expect(csvEscape(-5)).toBe("-5");
  });

  it("produces a header row, CRLF line endings and a UTF-8 BOM", () => {
    const csv = toCsv(["Name", "Amount (INR)"], [["Gupta Traders, Delhi", 1250.5], ["Iyer & Sons", 90]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual(["Name,Amount (INR)", '"Gupta Traders, Delhi",1250.5', "Iyer & Sons,90", ""]);
  });
});

describe("money formatting", () => {
  it("converts between rupees and paise without float drift", () => {
    expect(rupeesToPaise(92.45)).toBe(9245);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });

  it("formats paise with Indian digit grouping", () => {
    expect(formatINR(12_345_600)).toBe("₹1,23,456");
    expect(formatINR(9245, true)).toBe("₹92.45");
    expect(formatINR(null)).toBe("—");
  });
});
