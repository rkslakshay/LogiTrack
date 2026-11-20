import { humanize } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type Tone = "success" | "info" | "indigo" | "warning" | "danger" | "neutral" | "muted";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  indigo: "bg-violet-soft text-violet",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-neutral-soft text-ink-2",
  muted: "bg-neutral-soft text-ink-3",
};

const DOTS: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  indigo: "bg-violet",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-3",
  muted: "bg-line-strong",
};

/** One colour language for every status in the product. */
const STATUS_TONES: Record<string, Tone> = {
  // vehicles / drivers
  AVAILABLE: "success",
  ON_DELIVERY: "info",
  MAINTENANCE: "warning",
  OFF_DUTY: "neutral",
  INACTIVE: "muted",
  // deliveries
  PENDING: "neutral",
  ASSIGNED: "indigo",
  PICKED_UP: "indigo",
  IN_TRANSIT: "info",
  DELIVERED: "success",
  DELAYED: "warning",
  FAILED: "danger",
  CANCELLED: "muted",
  // maintenance / routes
  SCHEDULED: "indigo",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  PLANNED: "indigo",
  // reminders
  OVERDUE: "danger",
  DUE_SOON: "warning",
  OK: "success",
  // priorities
  LOW: "muted",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "danger",
  // severities
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  CRITICAL: "danger",
  // accounts
  ACTIVE: "success",
};

export const toneFor = (status: string | null | undefined): Tone => STATUS_TONES[status ?? ""] ?? "neutral";

export function Badge({ tone = "neutral", dot = false, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOTS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label, className }: { status: string | null | undefined; label?: string; className?: string }) {
  return (
    <Badge tone={toneFor(status)} dot className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}

const RISK_TONE: Record<string, Tone> = { LOW: "success", MEDIUM: "warning", HIGH: "danger" };
const RISK_LABEL: Record<string, string> = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" };

/** Delay-risk level of an open delivery. The reasons are available as a tooltip. */
export function RiskBadge({ risk }: { risk: { level: string; reasons: string[] } | null | undefined }) {
  if (!risk) return <span className="text-ink-3">—</span>;
  return (
    <span title={risk.reasons.join("\n")}>
      <Badge tone={RISK_TONE[risk.level] ?? "neutral"} dot>
        {RISK_LABEL[risk.level] ?? risk.level}
      </Badge>
    </span>
  );
}

/** Hex colours for charts and map markers, matching the badge tones. */
export const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "#15803d",
  ON_DELIVERY: "#2563eb",
  MAINTENANCE: "#d97706",
  INACTIVE: "#94a3b8",
  OFF_DUTY: "#64748b",
  PENDING: "#94a3b8",
  ASSIGNED: "#7c3aed",
  PICKED_UP: "#0891b2",
  IN_TRANSIT: "#2563eb",
  DELIVERED: "#15803d",
  DELAYED: "#d97706",
  FAILED: "#dc2626",
  CANCELLED: "#cbd5e1",
};
