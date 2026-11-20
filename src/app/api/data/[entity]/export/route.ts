import { csvResponse, route } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { exportCsv, permissionsFor } from "@/server/services/imports";

const date = (v: string | null, endOfDay = false) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Exports records in the import format (same columns as the template), so a file can be
 * edited and imported again. Filters: q, status, from, to (YYYY-MM-DD) and ids (comma list,
 * for exporting selected records). Never includes passwords, tokens or two-factor data.
 */
export const GET = route({}, async ({ user, params, query }) => {
  const p = permissionsFor(params.entity);
  if (!can(user.role, p.read)) throw forbidden();
  const ids = query.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5000) ?? null;
  const result = await exportCsv(user, params.entity, {
    q: query.get("q")?.trim().slice(0, 100) || null,
    status: query.get("status")?.trim().toUpperCase().slice(0, 30) || null,
    from: date(query.get("from")),
    to: date(query.get("to"), true),
    ids,
  });
  return csvResponse(result.filename, result.csv);
});
