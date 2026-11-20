import { csvResponse, route } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { permissionsFor, templateCsv } from "@/server/services/imports";

/** A CSV template with the supported columns and one example row. */
export const GET = route({}, async ({ user, params }) => {
  const p = permissionsFor(params.entity);
  if (!can(user.role, p.write) && !can(user.role, p.read)) throw forbidden();
  const t = templateCsv(params.entity);
  return csvResponse(t.filename, t.csv);
});
