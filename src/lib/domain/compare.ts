/** Period-over-period comparison helpers (pure). */

export type CompareMode = "none" | "previous" | "year";

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY = 86_400_000;

/**
 * The period a range is compared with.
 *  - "previous": the period of the same length immediately before it
 *  - "year":     the same dates one year earlier
 */
export function comparisonRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "none") return null;
  if (mode === "year") {
    const shift = (d: Date) => {
      const c = new Date(d);
      c.setFullYear(c.getFullYear() - 1);
      return c;
    };
    return { from: shift(range.from), to: shift(range.to) };
  }
  const length = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime() - 1);
  // Keep whole days: a 30-day range is compared with the 30 days before it.
  const days = Math.max(1, Math.round(length / DAY));
  const from = new Date(range.from.getTime() - days * DAY);
  return { from, to };
}

export interface Delta {
  current: number | null;
  previous: number | null;
  /** current - previous */
  change: number | null;
  /** Relative change as a fraction; null when the previous value is zero or missing. */
  pct: number | null;
}

export function delta(current: number | null | undefined, previous: number | null | undefined): Delta {
  const c = current ?? null;
  const p = previous ?? null;
  if (c == null || p == null) return { current: c, previous: p, change: null, pct: null };
  return { current: c, previous: p, change: c - p, pct: p !== 0 ? (c - p) / Math.abs(p) : null };
}

/** A change is worth explaining when it is both relatively and absolutely noticeable. */
export function isSignificant(d: Delta, opts: { pct?: number; abs?: number } = {}): boolean {
  if (d.change == null) return false;
  const absOk = Math.abs(d.change) >= (opts.abs ?? 0);
  const pctOk = d.pct == null ? Math.abs(d.change) > 0 : Math.abs(d.pct) >= (opts.pct ?? 0.1);
  return absOk && pctOk;
}
