import { route } from "@/lib/api";
import { can } from "@/lib/permissions";
import { columnsFor, IMPORT_ENTITIES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, permissionsFor } from "@/server/services/imports";

/** Supported columns per data type, and what the signed-in user may import or export. */
export const GET = route({}, async ({ user }) => ({
  maxBytes: MAX_IMPORT_BYTES,
  maxRows: MAX_IMPORT_ROWS,
  entities: IMPORT_ENTITIES.map((name) => {
    const p = permissionsFor(name);
    return { name, columns: columnsFor(name), canImport: can(user.role, p.write), canExport: can(user.role, p.read) };
  }).filter((e) => e.canExport || e.canImport),
}));
