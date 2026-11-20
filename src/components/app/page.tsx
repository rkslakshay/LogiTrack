import * as React from "react";
import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowUpRight, ChevronLeft, Inbox, Loader2, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-primary">
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const STAT_TONES = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  violet: "bg-violet-soft text-violet",
  neutral: "bg-neutral-soft text-ink-2",
} as const;

export interface StatDelta {
  /** Relative change as a fraction (0.12 = +12%); null when it cannot be calculated. */
  pct: number | null;
  /** Absolute change, used when the metric is itself a percentage (shown in points). */
  points?: number | null;
  /** Which direction is good news for this metric. */
  goodWhen: "up" | "down";
}

/** "+12%" in green or red depending on whether the movement is good for that metric. */
export function DeltaBadge({ delta }: { delta: StatDelta }) {
  const value = delta.points ?? (delta.pct == null ? null : delta.pct * 100);
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  const flat = Math.abs(rounded) < 0.5;
  const up = rounded > 0;
  const good = flat ? null : up === (delta.goodWhen === "up");
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const unit = delta.points != null ? " pts" : "%";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[11px] font-medium",
        good == null ? "bg-neutral-soft text-ink-3" : good ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
      )}
      title="Change against the comparison period"
    >
      <Icon className="size-3" aria-hidden />
      {flat ? "No change" : `${up ? "+" : ""}${rounded}${unit}`}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  href,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  href?: string;
  delta?: StatDelta | null;
}) {
  const body = (
    <Card className={cn("flex h-full items-start gap-3 p-3.5", href && "transition-colors hover:border-line-strong")}>
      {Icon && (
        <div className={cn("grid size-9 shrink-0 place-items-center rounded-md", STAT_TONES[tone])}>
          <Icon className="size-[18px]" aria-hidden />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium leading-snug text-ink-3">{label}</p>
        <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap text-lg font-semibold leading-tight text-ink">
          {value}
          {delta && <DeltaBadge delta={delta} />}
        </p>
        {hint && <p className="mt-0.5 text-xs leading-snug text-ink-3">{hint}</p>}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-14 text-[13px] text-ink-3", className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-12 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-full bg-neutral-soft text-ink-3">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-12 text-center", className)} role="alert">
      <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertCircle className="size-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-ink">Could not load this data</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Label / value pairs for detail pages. */
export function DetailList({ items, columns = 2 }: { items: { label: string; value: React.ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3")}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] font-medium text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-neutral-soft", className)} aria-hidden />;
}

/** Placeholder rows shaped like a table, shown while the first page of data loads. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      <span className="sr-only">Loading…</span>
      <div className="flex gap-4 bg-canvas/70 px-3 py-2.5">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cn("h-3", c === 0 ? "w-24" : "w-16 flex-1")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-28" : "flex-1", (r + c) % 3 === 0 && c !== 0 && "max-w-[60%]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a dashboard-style page: KPI cards followed by chart panels. */
export function DashboardSkeleton({ cards = 6, panels = 2 }: { cards?: number; panels?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: cards }, (_, i) => (
          <Card key={i} className="flex items-start gap-3 p-3.5">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </Card>
        ))}
      </div>
      <div className={cn("mt-4 grid gap-4", panels > 1 && "xl:grid-cols-2")}>
        {Array.from({ length: panels }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-56 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
