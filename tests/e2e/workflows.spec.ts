import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiGet, apiSend, isoDate, loginViaApi, loginViaUi, rowAction, selectContaining, toast, uniqueRegistration } from "./helpers";

interface Paged<T> {
  items: T[];
  total: number;
}

test.describe("Workflow A: vehicle and driver setup", () => {
  test("login → create vehicle → create driver → assign vehicle → verify records", async ({ page }) => {
    const registration = uniqueRegistration();
    const driverName = `Test Driver ${Date.now() % 100000}`;
    const licence = `MH12 2021 ${String(Date.now() % 10_000_000).padStart(7, "0")}`;

    await loginViaUi(page, "manager");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Create the vehicle.
    await page.goto("/vehicles");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    const vehicleDialog = page.getByRole("dialog");
    await vehicleDialog.getByLabel("Registration number").fill(registration);
    await vehicleDialog.getByLabel("Vehicle name").fill("E2E Test Van");
    await vehicleDialog.getByLabel("Vehicle type").selectOption({ label: "Van" });
    await vehicleDialog.getByLabel("Fuel type").selectOption({ label: "Diesel" });
    await vehicleDialog.getByLabel("Manufacturer").fill("Tata");
    await vehicleDialog.getByLabel("Model").fill("Winger Cargo");
    await vehicleDialog.getByLabel("Manufacturing year").fill("2023");
    await vehicleDialog.getByLabel("Fuel capacity (L)").fill("60");
    await vehicleDialog.getByLabel("Current odometer (km)").fill("1500");
    await vehicleDialog.getByLabel("Insurance expiry").fill(isoDate(300));
    await vehicleDialog.getByLabel("Registration expiry").fill(isoDate(1500));
    await vehicleDialog.getByRole("button", { name: "Add vehicle" }).click();
    await expect(toast(page, "Vehicle added")).toBeVisible();
    await expect(vehicleDialog).toBeHidden();

    // It is searchable in the list.
    await page.getByLabel("Search registration, name, driver…").fill(registration);
    const vehicleRow = page.getByRole("row").filter({ hasText: registration });
    await expect(vehicleRow).toBeVisible();
    await expect(vehicleRow).toContainText("Available");
    await expect(vehicleRow).toContainText("Unassigned");

    // Create the driver and assign the new vehicle in the same form.
    await page.goto("/drivers");
    await page.getByRole("button", { name: "Add driver" }).click();
    const driverDialog = page.getByRole("dialog");
    await driverDialog.getByLabel("Full name").fill(driverName);
    await driverDialog.getByLabel("Email").fill(`e2e.${Date.now()}@logitrack.in`);
    await driverDialog.getByLabel("Phone number").fill("+91 98765 43210");
    await driverDialog.getByLabel("Driving licence number").fill(licence);
    await driverDialog.getByLabel("Licence expiry").fill(isoDate(700));
    await driverDialog.getByLabel("Address").fill("12 MG Road, Pune 411001");
    await selectContaining(driverDialog.getByLabel("Assigned vehicle"), registration);
    await driverDialog.getByRole("button", { name: "Add driver" }).click();
    await expect(toast(page, "Driver added")).toBeVisible();

    // Verify from the driver side...
    await page.getByLabel("Search name, phone, licence…").fill(driverName);
    const driverRow = page.getByRole("row").filter({ hasText: driverName });
    await expect(driverRow).toContainText(registration);
    await expect(driverRow).toContainText("Available");

    // ...from the vehicle side...
    await page.goto("/vehicles");
    await page.getByLabel("Search registration, name, driver…").fill(registration);
    await expect(page.getByRole("row").filter({ hasText: registration })).toContainText(driverName);
    await page.getByRole("link", { name: registration }).click();
    await expect(page.getByRole("heading", { name: registration })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(driverName) })).toBeVisible();

    // ...and in the database through the API.
    const vehicles = await apiGet<Paged<{ registrationNumber: string; assignedDriver: { fullName: string } | null }>>(page.request, `/api/vehicles?q=${encodeURIComponent(registration)}`);
    expect(vehicles.total).toBe(1);
    expect(vehicles.items[0].assignedDriver?.fullName).toBe(driverName);

    // Validation: the same registration cannot be added twice.
    await page.goto("/vehicles");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    const again = page.getByRole("dialog");
    await again.getByLabel("Registration number").fill("not-a-plate");
    await again.getByRole("button", { name: "Add vehicle" }).click();
    await expect(again.getByText("Use the Indian format, e.g. MH 12 AB 1234")).toBeVisible();
    await expect(again.getByText("Vehicle name is required")).toBeVisible();
  });
});

test.describe("Workflow B: dispatching a delivery", () => {
  test("dispatcher creates a delivery → assigns driver and vehicle → updates status → history is recorded", async ({ page }) => {
    const customer = `E2E Customer ${Date.now() % 100000}`;
    await loginViaUi(page, "dispatcher");

    await page.goto("/deliveries");
    await page.getByRole("button", { name: "Create delivery" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Customer name").fill(customer);
    await dialog.getByLabel("Customer phone").fill("+91 98200 55501");
    await selectContaining(dialog.getByLabel("Pickup location"), "Kothrud, Pune");
    await selectContaining(dialog.getByLabel("Destination"), "Magarpatta City, Hadapsar, Pune");
    // The distance / time estimate appears once both ends are chosen.
    await expect(dialog.getByText(/Est\. travel time/)).toBeVisible();
    await dialog.getByLabel("Priority").selectOption({ label: "High" });
    await dialog.getByLabel("Delivery notes / instructions").fill("Handle with care");
    await dialog.getByRole("button", { name: "Create delivery" }).click();
    await expect(toast(page, /DEL-\d+ created/)).toBeVisible();

    // Open the new delivery from the list.
    await page.getByLabel("Search ID, customer, address, driver…").fill(customer);
    const row = page.getByRole("row").filter({ hasText: customer });
    await expect(row).toContainText("Pending");
    await expect(row).toContainText("Unassigned");
    await row.getByRole("link", { name: /DEL-\d+/ }).click();
    await expect(page.getByRole("heading", { name: /DEL-\d+/ })).toBeVisible();
    await expect(page.getByText("No driver or vehicle assigned yet.")).toBeVisible();

    // Assign: choosing the driver pre-selects their regular vehicle.
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const assign = page.getByRole("dialog");
    // A driver who is already out on a delivery cannot be picked.
    await expect(assign.getByLabel("Driver").locator("option", { hasText: "Suresh Yadav" })).toBeDisabled();
    await selectContaining(assign.getByLabel("Driver"), "Dinesh Chauhan");
    await expect(assign.getByLabel("Vehicle")).toHaveValue(/.+/);
    await assign.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(toast(page, "Assignment saved")).toBeVisible();
    await expect(page.getByRole("heading", { name: /DEL-\d+/ })).toContainText("Assigned");
    await expect(page.getByRole("link", { name: /Dinesh Chauhan/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /HR 55 AK 8093/ })).toBeVisible();

    // Walk the status through the workflow.
    for (const [label, done] of [["Picked Up", "picked up"], ["In Transit", "in transit"], ["Delivered", "delivered"]] as const) {
      await page.getByRole("button", { name: "Update status" }).click();
      const status = page.getByRole("dialog");
      await status.getByLabel("New status").selectOption({ label: label });
      await status.getByLabel(/Note/).fill(`Marked ${done} by e2e`);
      await status.getByRole("button", { name: "Update status" }).click();
      await expect(toast(page, new RegExp(`marked ${done}`))).toBeVisible();
      await expect(page.getByRole("heading", { name: /DEL-\d+/ })).toContainText(label);
    }

    // A closed delivery offers no further actions.
    await expect(page.getByRole("button", { name: "Update status" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByText("On time").first()).toBeVisible();

    // The full event history is recorded, in order, with who did it.
    const id = page.url().split("/").pop()!;
    const delivery = await apiGet<{ status: string; events: { type: string; status: string | null; note: string | null; user: { name: string } | null }[] }>(page.request, `/api/deliveries/${id}`);
    expect(delivery.status).toBe("DELIVERED");
    expect(delivery.events.map((e) => e.status)).toEqual(["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"]);
    expect(delivery.events[1].note).toContain("Dinesh Chauhan");
    expect(delivery.events.every((e) => e.user?.name === "Rohan Verma")).toBe(true);
    await expect(page.getByText("Marked delivered by e2e")).toBeVisible();
    await expect(page.getByText(/Assigned to Dinesh Chauhan with HR 55 AK 8093/)).toBeVisible();

    // The driver and vehicle are free again.
    const drivers = await apiGet<{ fullName: string; status: string }[]>(page.request, "/api/drivers/options");
    expect(drivers.find((d) => d.fullName === "Dinesh Chauhan")?.status).toBe("AVAILABLE");
  });
});

test.describe("Workflow C: GPS simulation", () => {
  test("start simulation → vehicle moves → delivery completes → vehicle is available", async ({ page }) => {
    await loginViaApi(page, "admin");
    const request = page.request;

    // Speed the simulator up so a city trip finishes in seconds.
    const settings = await apiGet<Record<string, unknown>>(request, "/api/settings");
    await apiSend(request, "put", "/api/settings", { ...settings, simulationSpeed: 120, simulationAutoComplete: true });

    // Dispatch a delivery with an available crew and put it on the road.
    const drivers = await apiGet<{ id: string; fullName: string; status: string; vehicle: { id: string; registrationNumber: string } | null }[]>(request, "/api/drivers/options");
    const driver = drivers.find((d) => d.fullName === "Ravi Shankar")!;
    expect(driver.status).toBe("AVAILABLE");
    const registration = driver.vehicle!.registrationNumber;
    const delivery = await apiSend<{ id: string; code: string }>(request, "post", "/api/deliveries", {
      customerName: "Simulator Test Stores", customerPhone: "+91 98200 55502",
      pickupAddress: "Electronic City Phase 1, Bengaluru", destinationAddress: "ITPL Whitefield, Bengaluru",
      pickupLat: 12.8452, pickupLng: 77.6602, destLat: 12.9857, destLng: 77.7369,
      scheduledAt: new Date().toISOString(), expectedAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      priority: "NORMAL", notes: "", driverId: driver.id, vehicleId: driver.vehicle!.id,
    });
    await apiSend(request, "post", `/api/deliveries/${delivery.id}/status`, { status: "PICKED_UP" });
    await apiSend(request, "post", `/api/deliveries/${delivery.id}/status`, { status: "IN_TRANSIT" });

    const locate = async () => {
      const snapshot = await apiGet<{ vehicles: { registrationNumber: string; lat: number; lng: number; status: string; delivery: { progress: number } | null }[] }>(request, "/api/tracking");
      return snapshot.vehicles.find((v) => v.registrationNumber === registration)!;
    };
    const before = await locate();
    expect(before.status).toBe("ON_DELIVERY");

    // The simulator is paused in the e2e environment: nothing moves yet.
    await page.goto("/tracking");
    await expect(page.getByText("Simulated GPS data")).toBeVisible();
    await expect(page.getByText(/Simulator\s*paused/)).toBeVisible();
    await page.waitForTimeout(3000);
    expect((await locate()).lat).toBe(before.lat);

    // Select the vehicle, then start the simulation from the UI.
    await page.getByRole("button", { name: new RegExp(registration) }).last().click();
    await expect(page.getByRole("link", { name: delivery.code })).toBeVisible();
    await expect(page.getByText("ITPL Whitefield, Bengaluru")).toBeVisible();
    const coordinates = page.locator("dt", { hasText: "Coordinates" }).locator("xpath=following-sibling::dd");
    const shownBefore = await coordinates.textContent();

    await page.getByRole("button", { name: "Resume simulation" }).click();
    await expect(page.getByText(/Simulator\s*running/)).toBeVisible();

    // The marker's coordinates change on screen without a page refresh...
    await expect(coordinates).not.toHaveText(shownBefore!, { timeout: 30_000 });
    // ...and the position is persisted in the database.
    const during = await locate();
    expect(during.lat !== before.lat || during.lng !== before.lng).toBe(true);

    // Pause really stops movement, resume continues.
    await page.getByRole("button", { name: "Pause simulation" }).click();
    await expect(page.getByText(/Simulator\s*paused/)).toBeVisible();
    await page.waitForTimeout(2500);
    const paused = await locate();
    await page.waitForTimeout(3000);
    expect((await locate()).lat).toBe(paused.lat);
    await page.getByRole("button", { name: "Resume simulation" }).click();

    // The delivery completes on arrival.
    await expect
      .poll(async () => (await apiGet<{ status: string }>(request, `/api/deliveries/${delivery.id}`)).status, { timeout: 120_000, intervals: [2000] })
      .toBe("DELIVERED");

    // The vehicle and driver are available again, parked at the destination.
    const after = await locate();
    expect(after.status).toBe("AVAILABLE");
    expect(after.delivery).toBeNull();
    expect(after.lat).toBeCloseTo(12.9857, 3);
    expect(after.lng).toBeCloseTo(77.7369, 3);
    const driversAfter = await apiGet<{ fullName: string; status: string }[]>(request, "/api/drivers/options");
    expect(driversAfter.find((d) => d.fullName === "Ravi Shankar")?.status).toBe("AVAILABLE");

    await page.goto("/vehicles");
    await page.getByLabel("Search registration, name, driver…").fill(registration);
    await expect(page.getByRole("row").filter({ hasText: registration })).toContainText("Available");

    // The completion was recorded as a system event from the simulator.
    const done = await apiGet<{ events: { status: string | null; note: string | null; user: unknown }[] }>(request, `/api/deliveries/${delivery.id}`);
    expect(done.events.at(-1)).toMatchObject({ status: "DELIVERED", note: "Arrived at destination (simulated GPS)", user: null });

    // Leave the environment as we found it.
    await apiSend(request, "post", "/api/simulator", { action: "pause" });
    await apiSend(request, "put", "/api/settings", settings);
  });
});

test.describe("Workflow D: fuel", () => {
  test("create fuel record → fuel analytics update → export report", async ({ page }) => {
    const station = `E2E Fuel Station ${Date.now() % 100000}`;
    await loginViaApi(page, "manager");
    await page.goto("/fuel");
    await expect(page.getByRole("heading", { name: "Fuel Management" })).toBeVisible();

    const before = await apiGet<{ totals: { fillCount: number; totalCostPaise: number } }>(page.request, "/api/fuel/summary");

    await page.getByRole("button", { name: "Add fuel record" }).click();
    const dialog = page.getByRole("dialog");
    await selectContaining(dialog.getByLabel("Vehicle"), "MH 02 FN 7719");
    // The odometer is pre-filled from the vehicle's current reading.
    await expect(dialog.getByLabel("Odometer reading (km)")).toHaveValue("18650");
    await dialog.getByLabel("Fuel station").fill(station);
    await dialog.getByLabel("Quantity (litres)").fill("8");
    await dialog.getByLabel("Price per litre (₹)").fill("104.50");
    await expect(dialog.getByText("₹836.00")).toBeVisible();

    // Validation: an odometer below the previous fill is rejected by the server.
    await dialog.getByLabel("Odometer reading (km)").fill("100");
    await dialog.getByRole("button", { name: "Add record" }).click();
    await expect(dialog.getByText(/Odometer cannot be lower than the previous fill/).first()).toBeVisible();
    await dialog.getByLabel("Odometer reading (km)").fill("18700");
    await dialog.getByRole("button", { name: "Add record" }).click();
    await expect(toast(page, "Fuel record added")).toBeVisible();

    // The record is in the history table.
    await page.getByLabel("Search station, vehicle, record ID…").fill(station);
    const row = page.getByRole("row").filter({ hasText: station });
    await expect(row).toContainText("MH 02 FN 7719");
    await expect(row).toContainText("₹836");

    // Analytics are recalculated from the saved records.
    const after = await apiGet<{ totals: { fillCount: number; totalCostPaise: number }; vehicles: { vehicle: { registrationNumber: string }; mileageKmPerL: number | null }[] }>(page.request, "/api/fuel/summary");
    expect(after.totals.fillCount).toBe(before.totals.fillCount + 1);
    expect(after.totals.totalCostPaise).toBe(before.totals.totalCostPaise + 83_600);
    expect(after.vehicles.find((v) => v.vehicle.registrationNumber === "MH 02 FN 7719")?.mileageKmPerL).toBeGreaterThan(0);
    await expect(page.getByText("Vehicle-wise fuel analysis")).toBeVisible();
    await expect(page.getByText("Monthly fuel expenditure")).toBeVisible();

    // Export the fuel report as CSV.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^logitrack-fuel-.*\.csv$/);
    const csv = readFileSync(await download.path(), "utf8");
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Record ID,Date,Vehicle,Vehicle Name,Quantity (L),Price per Litre (INR),Total Cost (INR),Odometer (km),Station,Notes");
    const exported = lines.find((l) => l.includes(station));
    expect(exported).toBeTruthy();
    expect(exported).toContain("MH 02 FN 7719");
    expect(exported).toContain("836.00");
    expect(lines.length).toBeGreaterThan(50);

    // The Reports page previews and exports the same data.
    await page.goto("/reports");
    await page.getByRole("button", { name: /Fuel records/ }).first().click();
    await expect(page.getByRole("heading", { name: /Fuel records · preview/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total Cost (INR)" })).toBeVisible();
    const [second] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(second.suggestedFilename()).toMatch(/\.csv$/);
  });
});

test.describe("Workflow E: maintenance", () => {
  test("schedule maintenance → reminder is raised → complete maintenance → vehicle status follows", async ({ page }) => {
    const description = `E2E brake inspection ${Date.now() % 100000}`;
    const registration = "DL 1C AF 9914";
    await loginViaApi(page, "manager");
    const vehicleStatus = async () =>
      (await apiGet<Paged<{ status: string }>>(page.request, `/api/vehicles?q=${encodeURIComponent(registration)}`)).items[0].status;
    expect(await vehicleStatus()).toBe("AVAILABLE");

    await page.goto("/maintenance");
    await page.getByRole("button", { name: "Schedule maintenance" }).click();
    const dialog = page.getByRole("dialog");
    await selectContaining(dialog.getByLabel("Vehicle"), registration);
    await dialog.getByLabel("Maintenance type").selectOption({ label: "Brake Service" });
    await dialog.getByLabel("Description").fill(description);
    await dialog.getByLabel(/^Service date/).fill(isoDate(2));
    await dialog.getByLabel("Service provider").fill("E2E Auto Works");
    await dialog.getByLabel("Cost (₹)").fill("3500");
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(toast(page, "Maintenance scheduled")).toBeVisible();

    // Scheduling alone keeps the vehicle in service, and a "due soon" reminder appears.
    expect(await vehicleStatus()).toBe("AVAILABLE");
    const reminder = page.getByRole("listitem").filter({ hasText: `${registration} · Brake Service` });
    await expect(reminder).toContainText(/Service due in \d day/);
    await expect(reminder).toContainText("Due Soon");

    // Trigger the reminder engine: it creates a persisted notification, once.
    await page.getByRole("button", { name: "Check reminders now" }).click();
    // (The background sweep may have got there first; either way exactly one notification must exist.)
    await expect(toast(page, /new reminder notification|Reminders are up to date/)).toBeVisible();
    const notifications = await apiGet<Paged<{ title: string; message: string; isRead: boolean }>>(page.request, `/api/notifications?q=${encodeURIComponent(registration)}&category=MAINTENANCE`);
    const mine = notifications.items.filter((n) => n.title === "Maintenance due soon" && n.message.includes("Brake Service"));
    expect(mine).toHaveLength(1);
    expect(mine[0].isRead).toBe(false);
    await page.getByRole("button", { name: "Check reminders now" }).click();
    await expect(toast(page, "Reminders are up to date")).toBeVisible();

    // Start the work: the vehicle is taken out of service.
    await page.getByLabel("Search description, provider, vehicle…").fill(description);
    await expect(page.getByRole("row").filter({ hasText: description })).toContainText("Scheduled");
    await rowAction(page, description, "Start work");
    await expect(toast(page, /is now under maintenance/)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: description })).toContainText("In Progress");
    expect(await vehicleStatus()).toBe("MAINTENANCE");

    // A vehicle under maintenance cannot be given a delivery.
    const vehicles = await apiGet<{ id: string; registrationNumber: string }[]>(page.request, "/api/vehicles/options");
    const drivers = await apiGet<{ id: string; status: string }[]>(page.request, "/api/drivers/options");
    const pending = await apiGet<Paged<{ id: string }>>(page.request, "/api/deliveries?status=PENDING&pageSize=1");
    const blocked = await page.request.post(`/api/deliveries/${pending.items[0].id}/assign`, {
      data: { driverId: drivers.find((d) => d.status === "AVAILABLE")!.id, vehicleId: vehicles.find((v) => v.registrationNumber === registration)!.id },
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.message).toContain("maintenance");

    // Complete the job with the final cost and a follow-up.
    await rowAction(page, description, "Mark completed");
    const complete = page.getByRole("dialog");
    await complete.getByLabel("Final cost (₹)").fill("4250");
    await complete.getByLabel("Next service date").fill(isoDate(180));
    await complete.getByRole("button", { name: "Mark completed" }).click();
    await expect(toast(page, "Maintenance completed")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: description });
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("₹4,250");
    expect(await vehicleStatus()).toBe("AVAILABLE");
    // The reminder for the finished job is gone.
    await expect(page.getByRole("listitem").filter({ hasText: `${registration} · Brake Service` })).toHaveCount(0);

    // The service appears in the vehicle's own history.
    await page.goto("/vehicles");
    await page.getByLabel("Search registration, name, driver…").fill(registration);
    await page.getByRole("link", { name: registration }).click();
    await page.getByRole("tab", { name: /Service history/ }).click();
    await expect(page.getByRole("row").filter({ hasText: description })).toContainText("Completed");
  });
});
