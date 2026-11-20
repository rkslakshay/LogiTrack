import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Loaded first by server.ts and the seed script so DATABASE_URL etc. are set
// before Prisma is imported. Variables already present in the environment win.
const file = resolve(process.cwd(), ".env");
if (existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Malformed .env: fall through to defaults below.
  }
}
process.env.DATABASE_URL ||= "file:./dev.db";
// LogiTrack ships as a demo by default; set DEMO_MODE=false for a clean, non-demo instance.
process.env.DEMO_MODE ||= "true";
