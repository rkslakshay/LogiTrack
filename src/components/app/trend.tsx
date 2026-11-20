import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

export interface TrendInfo {
  direction: "up" | "down" | "flat" | null;
  /** Change in on-time rate as a fraction. */
  onTimeChange: number | null;
  recent: { delivered: number; onTimeRate: number | null };
  previous: { delivered: number; onTimeRate: number | null };
}

/**
 * On-time rate in the last 30 days against the 30 days before. Shown only when
 * both windows hold enough deliveries; otherwise it says so instead of guessing.
 */
export function TrendCell({ trend }: { trend: TrendInfo }) {
  if (trend.direction == null || trend.onTimeChange == null) {
    return <span className="text-xs text-ink-3" title="Needs at least 3 delivered jobs in each of the last two 30-day windows">Not enough data</span>;
  }
  const points = Math.round(trend.onTimeChange * 100);
  const Icon = trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : ArrowRight;
  const tone = trend.direction === "up" ? "text-success" : trend.direction === "down" ? "text-danger" : "text-ink-3";
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium ${tone}`}
      title={`On time: ${pct(trend.recent.onTimeRate)} in the last 30 days (${trend.recent.delivered} delivered), ${pct(trend.previous.onTimeRate)} in the 30 days before (${trend.previous.delivered} delivered)`}
    >
      <Icon className="size-3.5" aria-hidden />
      {trend.direction === "flat" ? "Steady" : `${points > 0 ? "+" : ""}${points} pts`}
    </span>
  );
}
