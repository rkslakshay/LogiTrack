// Prisma CLI configuration (replaces the deprecated `package.json#prisma` block).
//
// With a config file, Prisma 6 no longer reads `.env` on its own, so the app's own loader
// runs first: it loads `.env` when present (Node's built-in loadEnvFile) and falls back to
// DATABASE_URL=file:./dev.db, exactly as the server and scripts do.
import "./src/server/env";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
