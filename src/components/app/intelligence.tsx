"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, ShieldAlert, Sparkles, Timer, Wrench } from "lucide-react";
import { useQuery } from "@/lib/client";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { fuelIntelligence, maintenanceIntelligence, riskOverview } from "@/server/services/intelligence";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "./page";
import { useSocketEvent } from "./providers";
import { Badge, RiskBadge, StatusBadge, type Tone } from "./status-badge";

export type FuelIntel = Awaited<ReturnType<typeof fuelIntelligence>>;
export type MaintenanceIntel = Awaited<ReturnType<typeof maintenanceIntelligence>>;
export type RiskOverview = Awaited<ReturnType<typeof riskOverview>>;

const SEVERITY_ICON = { INFO: Info, WARNING: AlertTriangle, CRITICAL: OctagonAlert } as const;
const SEVERITY_COLOR = { INFO: "text-info", WARNING: "text-warning", CRITICAL: "text-danger" } as const;

/** Small label that marks content as produced by a rule, not entered by a person. */
export function SystemTag({ children = "System-generated" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-violet-soft px-1.5 py-0.5 text-[11px] font-medium text-violet">
      <Sparkles className="size-3" aria-hidden />
      {children}
    </span>
  );
}

// --- Delivery risk ----------------------------------------------------------------

/** Dashboard card: open deliveries most likely to miss their expected time. */
export function RiskCard() {
  const { data, loading, error, reload } = useQuery<RiskOverview>("/api/intelligence/risk");
  useSocketEvent("delivery:updated", reload);
  const flagged = data?.items.filter((d) => d.risk.level !== "LOW") ?? [];
  return (
    <Card role="region" aria-label="Deliveries at risk">
      <CardHeader
        title="Deliveries at risk"
        description={data ? `${data.counts.high} high · ${data.counts.medium} medium · ${data.counts.low} low, of ${data.counts.total} open` : "Rule-based delay risk for open deliveries"}
        action={<Link href="/deliveries" className="text-xs font-medium text-primary hover:underline">All deliveries</Link>}
      />
      {error ? (
        <ErrorState message={error} onRetry={reload} className="py-8" />
      ) : loading || !data ? (
        <LoadingState className="py-8" />
      ) : flagged.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nothing at risk" description="Every open delivery is projected to arrive with time to spare." className="py-8" />
      ) : (
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto">
          {flagged.slice(0, 8).map((d) => (
            <li key={d.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/deliveries/${d.id}`} className="text-[13px] font-semibold text-primary hover:underline">{d.code}</Link>
                <span className="flex items-center gap-1.5"><StatusBadge status={d.status} /><RiskBadge risk={d.risk} /></span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-3">{d.customerName} · {d.driver?.fullName ?? "No driver"} · expected {formatDateTime(d.expectedAt)}</p>
              <p className="mt-1 text-[13px] text-ink-2">{d.risk.reasons[0]}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Projected from schedule, progress, distance and past delivery times. Rules, not predictions.</p>
    </Card>
  );
}

/** Delivery detail: the assessment with every reason listed. */
export function RiskPanel({ risk }: { risk: { level: string; reasons: string[]; etaAt: string | Date; slackMinutes: number; remainingKm: number } | null }) {
  if (!risk) return null;
  const tone = risk.level === "HIGH" ? "border-danger/30 bg-danger-soft/50" : risk.level === "MEDIUM" ? "border-warning/30 bg-warning-soft/50" : "border-line bg-surface";
  return (
    <Card className={tone} role="region" aria-label="Delay risk">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Timer className="size-4 text-ink-2" aria-hidden />
          Delay risk
        </h2>
        <RiskBadge risk={risk} />
      </div>
      <ul className="space-y-1.5 px-4 pb-1 pt-2">
        {risk.reasons.map((r) => (
          <li key={r} className="flex gap-2 text-[13px] text-ink-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
            {r}
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 pt-1.5 text-xs text-ink-3">
        Projected arrival {formatDateTime(risk.etaAt)} · {formatNumber(risk.remainingKm, true)} km to go. <SystemTag>Rule-based estimate</SystemTag>
      </p>
    </Card>
  );
}

// --- Fuel -------------------------------------------------------------------------

/** Vehicles whose fuel records raise a flag, with the reason for each. */
export function FuelFlagsCard({ data, loading, error, onRetry }: { data: FuelIntel | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const flagged = data?.vehicles.filter((v) => v.flags.length > 0) ?? [];
  return (
    <Card role="region" aria-label="Fuel intelligence">
      <CardHeader title="Fuel intelligence" description="Mileage drops, poor performers and gaps in the records, judged on at least 180 days of fills" action={<SystemTag />} />
      {error ? (
        <ErrorState message={error} onRetry={onRetry} className="py-8" />
      ) : loading || !data ? (
        <LoadingState className="py-8" />
      ) : flagged.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No fuel issues found" description="Mileage is steady and records look complete for the selected period." className="py-8" />
      ) : (
        <ul className="scroll-thin max-h-[268px] divide-y divide-line overflow-y-auto" tabIndex={0} aria-label="Flagged fuel records">
          {flagged.map((v) => (
            <li key={v.vehicleId} className="px-4 py-2.5">
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                <Link href={`/vehicles/${v.vehicleId}`} className="text-primary hover:underline">{v.registrationNumber}</Link>
                <span className="text-xs font-normal text-ink-3">{v.groupLabel}{v.mileageKmPerL != null ? ` · ${v.mileageKmPerL.toFixed(1)} km/L` : ""}</span>
              </p>
              <ul className="mt-1 space-y-1">
                {v.flags.map((f) => {
                  const Icon = SEVERITY_ICON[f.severity];
                  return (
                    <li key={f.code} className="flex gap-2 text-[13px] text-ink-2">
                      <Icon className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_COLOR[f.severity]}`} aria-hidden />
                      {f.message}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Maintenance ------------------------------------------------------------------

const URGENCY_TONE: Record<string, Tone> = { OVERDUE: "danger", SOON: "warning", PLANNED: "info" };
const URGENCY_LABEL: Record<string, string> = { OVERDUE: "Overdue", SOON: "Within 30 days", PLANNED: "Within 60 days" };

export interface ScheduleSuggestion {
  vehicleId: string;
  description: string;
  projectedDate: Date | string | null;
}

/**
 * Service recommendations computed by the system. They are suggestions only:
 * nothing is booked until someone presses Schedule and saves a real job.
 */
export function ServiceRecommendationsCard({ onSchedule }: { onSchedule?: (s: ScheduleSuggestion) => void }) {
  const { data, loading, error, reload } = useQuery<MaintenanceIntel>("/api/intelligence/maintenance");
  return (
    <Card role="region" aria-label="Recommended services">
      <CardHeader title="Recommended services" description="Suggested from odometer, service history and recent usage. Not yet scheduled." action={<SystemTag />} />
      {error ? (
        <ErrorState message={error} onRetry={reload} className="py-8" />
      ) : loading || !data ? (
        <LoadingState className="py-8" />
      ) : data.recommendations.length === 0 ? (
        <EmptyState icon={Wrench} title="No recommendations" description="No vehicle is close to its routine service interval." className="py-8" />
      ) : (
        <ul className="scroll-thin max-h-72 divide-y divide-line overflow-y-auto">
          {data.recommendations.map((r) => (
            <li key={r.vehicleId} className="flex items-start gap-3 px-4 py-2.5">
              <ShieldAlert className={`mt-0.5 size-4 shrink-0 ${r.urgency === "OVERDUE" ? "text-danger" : r.urgency === "SOON" ? "text-warning" : "text-info"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
                  {r.registrationNumber} · Routine service
                  <Badge tone={URGENCY_TONE[r.urgency]}>{URGENCY_LABEL[r.urgency]}</Badge>
                </p>
                <p className="mt-0.5 text-xs text-ink-2">{r.reason}</p>
                {r.projectedDate && r.urgency !== "OVERDUE" && <p className="mt-0.5 text-xs text-ink-3">Suggested by {formatDate(r.projectedDate)}</p>}
              </div>
              {onSchedule && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onSchedule({ vehicleId: r.vehicleId, description: `Routine service (recommended: ${r.reason})`.slice(0, 480), projectedDate: r.projectedDate })}
                >
                  Schedule
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
