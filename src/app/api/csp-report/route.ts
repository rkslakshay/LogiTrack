import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { limiter } from "@/lib/rate-limit";

const log = logger("csp");
const reports = limiter("csp:reports", 60_000, 30);

/**
 * Receives Content-Security-Policy violation reports from browsers and logs them,
 * so a blocked script shows up on the diagnostics page. Browsers send these without
 * credentials, so this endpoint is public; it is size-capped and rate-limited and
 * only ever logs (it changes nothing).
 */
export async function POST(req: NextRequest) {
  const address = req.headers.get("x-logitrack-client-ip") ?? "unknown";
  if (!reports.hit(address).allowed) return new Response(null, { status: 204 });
  const text = (await req.text()).slice(0, 8000);
  try {
    const body = JSON.parse(text) as { "csp-report"?: Record<string, unknown> };
    const r = body["csp-report"] ?? {};
    log.warn("csp.violation", {
      directive: r["violated-directive"] ?? r["effective-directive"],
      blocked: typeof r["blocked-uri"] === "string" ? String(r["blocked-uri"]).slice(0, 200) : undefined,
      page: typeof r["document-uri"] === "string" ? String(r["document-uri"]).split("#")[0].slice(0, 200) : undefined,
      source: r["source-file"],
      line: r["line-number"],
    });
  } catch {
    log.warn("csp.report_unreadable");
  }
  return new Response(null, { status: 204 });
}
