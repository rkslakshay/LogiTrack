import { csvResponse, parseRange, route } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { logActivity } from "@/server/services/activity";
import { buildReport } from "@/server/services/reports";

/** ?format=json returns a preview; otherwise the full report is downloaded as CSV. */
export const GET = route({ permission: "reports:export" }, async ({ user, params, query }) => {
  const report = await buildReport(params.type, parseRange(query, 30));
  if (query.get("format") === "json") {
    return { type: report.type, title: report.title, headers: report.headers, rowCount: report.rows.length, preview: report.rows.slice(0, 8) };
  }
  await logActivity(prisma, user, "EXPORT", "Report", null, `Exported "${report.title}" report (${report.rows.length} rows)`);
  return csvResponse(report.filename, toCsv(report.headers, report.rows));
});
