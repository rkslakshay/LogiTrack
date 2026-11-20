import { dirname, isAbsolute, join, resolve } from "node:path";

/** Absolute path of the SQLite file, resolved the way Prisma resolves it (relative to prisma/). */
export function databasePath(url = process.env.DATABASE_URL ?? "file:./dev.db"): string {
  if (!url.startsWith("file:")) throw new Error("Only SQLite (file:) databases are supported.");
  const raw = url.slice("file:".length).split("?")[0];
  return isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? resolve(raw) : resolve(process.cwd(), "prisma", raw);
}

/** Directory that holds the database; data that must persist with it (backups, the app secret) lives here. */
export function dataDirectory(): string {
  return dirname(databasePath());
}

export function dataFile(name: string): string {
  return join(dataDirectory(), name);
}
