// Runs in every test worker before any module is imported.
process.env.DATABASE_URL = "file:./test.db";
// Never touch the network from tests: use the offline route estimator.
process.env.ROUTING_PROVIDER = "local";
// Tests drive the simulator explicitly; nothing may start ticking in the background.
process.env.SIMULATOR_AUTOSTART = "false";
process.env.DEMO_MODE = "true";
// Deterministic key for encrypting two-factor secrets in tests (never used outside tests).
process.env.APP_SECRET = "test-only-app-secret-0123456789abcdef0123456789abcdef";
// Backups made by tests stay in their own folder, away from the development backups.
process.env.BACKUP_DIR = "./prisma/test-backups";
// Expected warnings (failed sign-ins in security tests) would flood the output.
process.env.LOG_LEVEL ??= "error";
