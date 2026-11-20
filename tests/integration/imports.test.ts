import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv, toCsv, unguard } from "@/lib/csv";
import { exportCsv, readDate, readNumber, runImport, templateCsv } from "@/server/services/imports";
import { createFuel } from "@/server/services/fuel";
import { createVehicle } from "@/server/services/vehicles";
import { makeUser, prisma, resetDb, vehicleInput } from "../helpers";

beforeAll(resetDb);

const VEHICLE_HEADER = "Registration Number,Name,Type,Manufacturer,Model,Year,Fuel Type,Fuel Capacity (L),Odometer (km),Status,Insurance Expiry,Registration Expiry";
const vehicleRow = (reg: string, extra: Partial<Record<"name" | "type" | "year" | "capacity", string>> = {}) =>
  `${reg},${extra.name ?? "Import Van"},${extra.type ?? "Van"},Tata,Winger,${extra.year ?? "2022"},Diesel,${extra.capacity ?? "60"},12000,Available,2027-03-31,31/12/2034`;

describe("CSV parsing", () => {
  it("handles BOM, quotes, escaped quotes, commas and line breaks inside values, CRLF and blank lines", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,2,3\n');
    expect(rows.map((r) => r.cells)).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"], ["1", "2", "3"]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"open,2\n')).toThrow(/never closed/);
  });

  it("round-trips its own exports, including formula-guarded values", () => {
    const csv = toCsv(["Name", "Phone"], [["=SUM(A1)", "+91 98200 12345"]]);
    const [, row] = parseCsv(csv);
    expect(row.cells.map(unguard)).toEqual(["=SUM(A1)", "+91 98200 12345"]);
  });

  it("reads Indian and ISO dates strictly, and formatted numbers", () => {
    expect(readDate("d", "2026-02-28")?.getDate()).toBe(28);
    expect(readDate("d", "31/12/2026")?.getMonth()).toBe(11);
    expect(readDate("d", "2026-12-01 09:30")?.getHours()).toBe(9);
    expect(() => readDate("d", "2026-02-30")).toThrow(/not a real date/);
    expect(() => readDate("d", "next tuesday")).toThrow(/not a date/);
    expect(readNumber("n", "₹ 1,25,000.50")).toBe(125000.5);
    expect(() => readNumber("n", "12abc")).toThrow(/not a number/);
  });
});

describe("vehicle import", () => {
  it("previews without writing anything, then commits all rows in one go", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const csv = [VEHICLE_HEADER, vehicleRow("MH 12 IM 1001"), vehicleRow("mh-12-im-1002", { type: "MINI_TRUCK" })].join("\n");
    const before = await prisma.vehicle.count();

    const preview = await runImport(admin, "vehicles", csv, { commit: false });
    expect(preview.committed).toBe(false);
    expect(preview.summary).toMatchObject({ total: 2, valid: 2, invalid: 0, imported: 0 });
    expect(await prisma.vehicle.count()).toBe(before);

    const done = await runImport(admin, "vehicles", csv, { commit: true, fileName: "fleet.csv" });
    expect(done.committed).toBe(true);
    expect(done.summary.imported).toBe(2);
    expect(await prisma.vehicle.count()).toBe(before + 2);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { registrationNumber: "MH 12 IM 1002" } });
    expect(v.type).toBe("MINI_TRUCK");
    expect(await prisma.activityLog.count({ where: { entityType: "Import" } })).toBe(1);
  });

  it("reports row-level errors and duplicates, and imports nothing unless told to skip them", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const csv = [
      VEHICLE_HEADER,
      vehicleRow("MH 12 IM 2001"),
      vehicleRow("MH 12 IM 2002", { year: "1890" }),
      vehicleRow("MH 12 IM 2003", { type: "Spaceship" }),
      vehicleRow("MH 12 IM 2001"), // duplicate inside the file
      vehicleRow("MH 12 IM 1001"), // already in the database
      vehicleRow("NOT A REG"),
    ].join("\n");
    const before = await prisma.vehicle.count();

    const rejected = await runImport(admin, "vehicles", csv, { commit: true });
    expect(rejected.committed).toBe(false);
    expect(rejected.summary).toMatchObject({ total: 6, valid: 1, invalid: 3, duplicate: 2, imported: 0 });
    expect(await prisma.vehicle.count()).toBe(before); // nothing was written

    const byLine = Object.fromEntries(rejected.rows.map((r) => [r.line, r]));
    expect(byLine[3].errors.Year).toMatch(/1990/);
    expect(byLine[4].errors.Type).toMatch(/Spaceship/);
    expect(byLine[5].errors._).toMatch(/line 2/);
    expect(byLine[6].errors._).toMatch(/already belongs/);
    expect(byLine[7].status).toBe("invalid");

    const partial = await runImport(admin, "vehicles", csv, { commit: true, skipInvalid: true });
    expect(partial.summary).toMatchObject({ imported: 1, skipped: 5 });
    expect(await prisma.vehicle.count()).toBe(before + 1);
  });

  it("refuses files with missing columns, no rows or broken quoting", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    await expect(runImport(admin, "vehicles", "Name,Type\nX,Van", { commit: false })).rejects.toMatchObject({ status: 422 });
    await expect(runImport(admin, "vehicles", VEHICLE_HEADER, { commit: false })).rejects.toMatchObject({ status: 400 });
    await expect(runImport(admin, "vehicles", `${VEHICLE_HEADER}\n"unclosed`, { commit: false })).rejects.toMatchObject({ status: 400 });
    await expect(runImport(admin, "spaceships", VEHICLE_HEADER, { commit: false })).rejects.toMatchObject({ status: 400 });
  });

  it("enforces permissions per data type", async () => {
    const dispatcher = await makeUser("DISPATCHER");
    const csv = [VEHICLE_HEADER, vehicleRow("MH 12 IM 3001")].join("\n");
    await expect(runImport(dispatcher, "vehicles", csv, { commit: true })).rejects.toMatchObject({ status: 403 });
    const driver = await makeUser("DRIVER");
    await expect(runImport(driver, "deliveries", "x\n1", { commit: false })).rejects.toMatchObject({ status: 403 });
  });
});

describe("fuel, maintenance, drivers and deliveries", () => {
  it("applies business rules from the services (tank capacity, odometer order) per row", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const v = await createVehicle(admin, vehicleInput({ registrationNumber: "MH 14 FU 1234", fuelCapacity: 50, odometer: 10_000 }));
    await createFuel(admin, { vehicleId: v.id, date: new Date("2026-10-10"), quantityL: 30, pricePerLitre: 95, odometer: 11_000, station: "HP", notes: null });
    const csv = [
      "Vehicle Registration,Date,Quantity (L),Price per Litre (INR),Odometer (km),Station,Notes",
      "MH 14 FU 1234,2026-10-20,40,94.5,11500,IOCL Wakad,",
      "MH 14 FU 1234,2026-10-25,80,94.5,11800,IOCL Wakad,", // over tank capacity
      "MH 14 FU 1234,2026-10-30,20,94.5,10500,IOCL Wakad,", // odometer lower than an earlier fill
      "MH 99 ZZ 9999,2026-10-30,20,94.5,10500,IOCL Wakad,", // unknown vehicle
    ].join("\n");
    const r = await runImport(admin, "fuel", csv, { commit: false });
    expect(r.rows.map((x) => x.status)).toEqual(["valid", "invalid", "invalid", "invalid"]);
    expect(Object.values(r.rows[1].errors).join(" ")).toMatch(/capacity/i);
    expect(Object.values(r.rows[2].errors).join(" ")).toMatch(/odometer/i);
    expect(r.rows[3].errors["Vehicle Registration"]).toMatch(/No vehicle/);
    expect(await prisma.fuelRecord.count({ where: { vehicleId: v.id } })).toBe(1);
  });

  it("imports completed maintenance with its service date and pending deliveries offline", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    await createVehicle(admin, vehicleInput({ registrationNumber: "MH 14 MN 4321" }));
    const maint = await runImport(admin, "maintenance", [
      "Vehicle Registration,Type,Description,Service Date,Status,Cost (INR),Provider",
      "MH 14 MN 4321,Oil Change,Oil and filter,2026-09-01,Completed,\"3,850\",Tata Service",
    ].join("\n"), { commit: true });
    expect(maint.summary.imported).toBe(1);
    const m = await prisma.maintenanceRecord.findFirstOrThrow({ where: { vehicle: { registrationNumber: "MH 14 MN 4321" } } });
    expect(m.costPaise).toBe(385_000);
    expect(m.completedAt?.toISOString().slice(0, 10)).toBe(m.serviceDate.toISOString().slice(0, 10));

    const del = await runImport(admin, "deliveries", [
      "Customer Name,Customer Phone,Pickup Address,Pickup Latitude,Pickup Longitude,Destination Address,Destination Latitude,Destination Longitude,Scheduled At,Expected At,Priority",
      "Patil Traders,+91 98220 33445,Wakad,18.5987,73.7652,Kharadi,18.5515,73.9348,2026-12-02 09:00,2026-12-02 12:00,High",
      "Patil Traders,+91 98220 33445,Wakad,18.5987,73.7652,Kharadi,18.5515,73.9348,2026-12-02 11:00,2026-12-02 10:00,High",
    ].join("\n"), { commit: true, skipInvalid: true });
    expect(del.summary).toMatchObject({ imported: 1, skipped: 1 });
    expect(del.rows[1].errors["Expected At"]).toMatch(/after/);
    const d = await prisma.delivery.findFirstOrThrow({ where: { customerName: "Patil Traders" }, include: { events: true } });
    expect(d.status).toBe("PENDING");
    expect(d.distanceKm).toBeGreaterThan(0);
    expect(d.events[0].note).toMatch(/Imported/);
  });

  it("never imports driver passwords and detects licence clashes", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const header = "Full Name,Email,Phone,Address,License Number,License Expiry,Joining Date,Password";
    const r = await runImport(admin, "drivers", [
      header,
      "Kavita Joshi,kavita.j@example.in,+91 98220 55667,Aundh Pune,MH12 2019 0045678,2029-01-01,2024-01-01,Secret-Pass-1",
      "Anil Rao,anil.r@example.in,+91 98220 55668,Baner Pune,MH12 2019 0045678,2029-01-01,2024-01-01,",
    ].join("\n"), { commit: true, skipInvalid: true });
    expect(r.ignoredColumns).toEqual(["Password"]);
    expect(r.summary.imported).toBe(1);
    const d = await prisma.driver.findFirstOrThrow({ where: { email: "kavita.j@example.in" } });
    expect(d.userId).toBeNull(); // no login account created from a file
  });
});

describe("export", () => {
  it("exports in the import format, round-trips, and leaves out secrets", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const out = await exportCsv(admin, "vehicles", { q: "IM 100" });
    const [head, ...rows] = parseCsv(out.csv);
    expect(head.cells.join(",")).toBe(VEHICLE_HEADER);
    expect(rows.length).toBe(2);
    expect(out.csv).not.toMatch(/passwordHash|mfa|token/i);
    // Re-importing the export finds every row as a duplicate instead of creating copies.
    const again = await runImport(admin, "vehicles", out.csv, { commit: true });
    expect(again.summary).toMatchObject({ duplicate: 2, imported: 0 });
    expect(templateCsv("fuel").csv.split("\r\n")[0]).toContain("Vehicle Registration");
  });

  it("supports exporting selected records by id", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const one = await prisma.vehicle.findFirstOrThrow({ where: { registrationNumber: "MH 12 IM 1001" } });
    const out = await exportCsv(admin, "vehicles", { ids: [one.id] });
    expect(out.count).toBe(1);
  });
});
