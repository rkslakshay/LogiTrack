import { NextResponse } from "next/server";
import { health } from "@/server/services/diagnostics";

export const dynamic = "force-dynamic";

/** Public health probe (Docker healthcheck, uptime monitors). Returns 503 when the database is unreachable. */
export async function GET() {
  const result = await health();
  return NextResponse.json(result, { status: result.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
