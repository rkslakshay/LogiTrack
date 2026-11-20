import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { createSession, getUserByToken } from "@/lib/auth";
import { createBackup, backupPath, checkLiveDatabase, deleteBackup, listBackups, pruneScheduledBackups, restoreBackup, verifyBackup } from "@/server/services/backup";
import { diagnostics, health } from "@/server/services/diagnostics";
import { createVehicle } from "@/server/services/vehicles";
import { makeUser, prisma, resetDb, vehicleInput } from "../helpers";

beforeAll(resetDb);

describe("live database checks", () => {
  it("reports integrity, migrations and counts", async () => {
    const live = await checkLiveDatabase();
    expect(live.ok).toBe(true);
    expect(live.integrity).toBe("ok");
    expect(live.foreignKeyViolations).toBe(0);
    expect(live.migrations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("backup and restore", () => {
  it("creates a verified backup with a manifest, and restores it transactionally", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const before = await createVehicle(admin, vehicleInput({ name: "Kept Vehicle" }));

    const backup = await createBackup({ reason: "manual", actor: admin });
    expect(backup.verification.ok).toBe(true);
    expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(backup.verification.counts.Vehicle).toBe(1);
    expect(existsSync(backupPath(backup.file))).toBe(true);
    expect(existsSync(`${backupPath(backup.file)}.json`)).toBe(true);
    expect((await listBackups()).map((b) => b.file)).toContain(backup.file);

    // Change the data after the backup, and sign someone in.
    await createVehicle(admin, vehicleInput({ name: "Added Later" }));
    await prisma.vehicle.update({ where: { id: before.id }, data: { name: "Renamed Later" } });
    const { token } = await createSession(admin.id);

    const result = await restoreBackup(backup.file, admin);
    expect(result.restoredFrom).toBe(backup.file);
    const vehicles = await prisma.vehicle.findMany();
    expect(vehicles.map((v) => v.name)).toEqual(["Kept Vehicle"]);
    // Sessions are never restored: everyone signs in again.
    expect(await getUserByToken(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);

    // The safety backup holds the pre-restore state, so the restore can be undone.
    const safety = (await listBackups()).find((b) => b.file === result.safetyBackup)!;
    expect(safety.reason).toBe("pre-restore");
    expect(safety.counts?.Vehicle).toBe(2);
    expect((await checkLiveDatabase()).ok).toBe(true);
  });

  it("detects a backup file that was changed after it was made", async () => {
    const backup = await createBackup({ reason: "manual" });
    const path = backupPath(backup.file);
    const bytes = await readFile(path);
    bytes[bytes.length - 100] ^= 0xff;
    await writeFile(path, bytes);
    const check = await verifyBackup(backup.file);
    expect(check.sha256Matches).toBe(false);
  });

  it("refuses a backup made with a different schema and leaves the data untouched", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const backup = await createBackup({ reason: "manual" });
    // Simulate a backup from another version by adding a migration only it has.
    const other = new PrismaClient({ datasourceUrl: `file:${backupPath(backup.file).replace(/\\/g, "/")}` });
    await other.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, started_at, applied_steps_count) VALUES ('x', 'x', '29991231000000_future', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
    );
    await other.$disconnect();
    const vehiclesBefore = await prisma.vehicle.count();
    await createVehicle(admin, vehicleInput());
    await expect(restoreBackup(backup.file, admin)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.vehicle.count()).toBe(vehiclesBefore + 1);
  });

  it("rejects names that are not backups and deletes only real ones", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    expect(() => backupPath("../dev.db")).toThrow();
    expect(() => backupPath("logitrack-20260101-000000-manual.db/../../dev.db")).toThrow();
    await expect(restoreBackup("../test.db", admin)).rejects.toMatchObject({ status: 400 });
    const backup = await createBackup({ reason: "manual" });
    await deleteBackup(backup.file, admin);
    expect(existsSync(backupPath(backup.file))).toBe(false);
    await expect(deleteBackup(backup.file, admin)).rejects.toMatchObject({ status: 404 });
  });

  it("prunes old scheduled backups but never manual or safety ones", async () => {
    for (let i = 0; i < 3; i++) await createBackup({ reason: "scheduled" });
    const manual = (await listBackups()).filter((b) => b.reason !== "scheduled").length;
    await pruneScheduledBackups(1);
    const after = await listBackups();
    expect(after.filter((b) => b.reason === "scheduled")).toHaveLength(1);
    expect(after.filter((b) => b.reason !== "scheduled")).toHaveLength(manual);
  });
});

describe("health and diagnostics", () => {
  it("health reveals only status and version", async () => {
    const h = await health();
    expect(h).toMatchObject({ status: "ok", database: "ok" });
    expect(Object.keys(h).sort()).toEqual(["database", "responseMs", "status", "version"]);
  });

  it("diagnostics cover every subsystem and contain no secrets", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    await createSession(admin.id);
    const d = await diagnostics();
    expect(d.database).toMatchObject({ ok: true });
    expect(d.simulator).toHaveProperty("running");
    expect(d.realtime).toHaveProperty("connected");
    expect(Array.isArray(d.jobs)).toBe(true);
    expect(d.app.version).toMatch(/^\d+\.\d+\.\d+/);
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/passwordHash|tokenHash|mfaSecret|APP_SECRET|test-only-app-secret/);
    expect(text).not.toContain(admin.email);
  });
});
