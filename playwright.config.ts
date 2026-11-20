import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);
// SHOTS=1 switches from the test suite to the README screenshot run (live simulator, road geometry).
const SHOTS = !!process.env.SHOTS;

/**
 * End-to-end tests run against a real server with its own seeded database
 * (prisma/e2e.db), so they never touch development data.
 *
 * Browser: the bundled Chromium by default (`npx playwright install chromium`).
 * To use a browser that is already installed, set PW_CHANNEL=msedge or PW_CHANNEL=chrome.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: SHOTS ? "**/*.shots.ts" : "**/*.spec.ts",
  // The workflows share one database and one simulator, so they run in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The dev server compiles each page on first visit.
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: "tsx tests/e2e/prepare-db.ts && tsx server.ts",
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "file:./e2e.db",
      PORT: String(PORT),
      // Deterministic and offline: no external routing, simulator controlled by the tests.
      ROUTING_PROVIDER: SHOTS ? "osrm" : "local",
      SIMULATOR_AUTOSTART: SHOTS ? "true" : "false",
      DEMO_MODE: "true",
      // The suite signs in ~100 times from 127.0.0.1. Production keeps the default of 30 per 15 minutes;
      // the limiter itself is covered by the Vitest security tests.
      LOGIN_LIMIT_PER_ADDRESS: "1000",
      BACKUP_INTERVAL_HOURS: "0",
      // Keep backups made by the tests away from the development backups.
      BACKUP_DIR: "./prisma/e2e-backups",
      LOG_LEVEL: "warn",
    },
  },
});
