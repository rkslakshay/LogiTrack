"use client";

import { useMemo, useState } from "react";
import { format, startOfMonth, startOfWeek, startOfYear, subDays, subMonths } from "date-fns";
import { Select } from "@/components/ui/input";
import { DateRangeFilter } from "./data-table";

const PRESETS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
] as const;
export type RangePreset = (typeof PRESETS)[number]["value"];

const COMPARISONS = [
  { value: "previous", label: "vs previous period" },
  { value: "year", label: "vs same period last year" },
  { value: "none", label: "No comparison" },
] as const;
export type Comparison = (typeof COMPARISONS)[number]["value"];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function presetRange(preset: RangePreset, today: Date = new Date()): { from: string; to: string } {
  const from =
    preset === "week" ? startOfWeek(today, { weekStartsOn: 1 })
    : preset === "month" ? startOfMonth(today)
    : preset === "year" ? startOfYear(today)
    : preset === "7d" ? subDays(today, 6)
    : preset === "30d" ? subDays(today, 29)
    : preset === "90d" ? subDays(today, 89)
    : preset === "6m" ? subMonths(today, 6)
    : subMonths(today, 12);
  return { from: iso(from), to: iso(today) };
}

/**
 * Date-range state shared by the dashboard, analytics, performance and reports pages.
 * Pass `compare` to also offer a comparison period (analytics).
 */
export function useRange(initial: RangePreset = "30d", options: { compare?: Comparison } = {}) {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState(() => presetRange(initial));
  const [comparison, setComparison] = useState<Comparison>(options.compare ?? "none");
  const range = useMemo(() => (preset === "custom" ? custom : presetRange(preset)), [preset, custom]);
  const label = PRESETS.find((p) => p.value === preset)!.label.toLowerCase();
  const offersComparison = options.compare !== undefined;

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={preset}
        aria-label="Date range"
        className="w-40"
        onChange={(e) => {
          const next = e.target.value as RangePreset;
          if (next === "custom") setCustom(range);
          setPreset(next);
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {preset === "custom" && <DateRangeFilter from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} />}
      {offersComparison && (
        <Select value={comparison} aria-label="Comparison period" className="w-52" onChange={(e) => setComparison(e.target.value as Comparison)}>
          {COMPARISONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
  return {
    ...range,
    comparison,
    query: `from=${range.from}&to=${range.to}`,
    /** Same as `query`, plus the comparison mode when one is selected. */
    compareQuery: `from=${range.from}&to=${range.to}${comparison !== "none" ? `&compare=${comparison}` : ""}`,
    picker,
    label: preset === "custom" ? "selected period" : label,
    /** Reads naturally in a sentence: "in the last 30 days", "this month". */
    phrase: preset === "custom" ? "in the selected period" : label.startsWith("this") ? label : `in the ${label}`,
  };
}
