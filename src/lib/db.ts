import { PrismaClient } from "@prisma/client";

// One PrismaClient per process. The custom server (server.ts) and the Next.js
// bundles share it through globalThis so SQLite only ever sees a single writer pool.
const globalForPrisma = globalThis as unknown as { __logitrackPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__logitrackPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "true" ? ["query", "warn", "error"] : ["error"],
  });

globalForPrisma.__logitrackPrisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Db = PrismaClient | Tx;

/** Generates the next human-readable code for an entity, e.g. VEH-0016. */
export async function nextCode(db: Db, name: string, prefix: string, width = 4): Promise<string> {
  const counter = await db.counter.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(counter.value).padStart(width, "0")}`;
}
