"use client";

import * as React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "./page";

/**
 * Chart palette.
 * - SERIES: categorical hues, always assigned in this fixed order (identity).
 * - OUTCOME: reserved status colours (good / warning / critical), only used for
 *   outcomes and always paired with a legend label, never colour alone.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
export const OUTCOME = { good: "#1a8f4c", warning: "#e0900b", critical: "#d43b3b", neutral: "#a3aec0" } as const;

const AXIS = { fontSize: 11, fill: "#71829b" } as const;
const GRID = "#e9edf2";
const SURFACE = "#ffffff";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

type Formatter = (value: number) => string;
const defaultFormat: Formatter = (v) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);

/** Compact axis ticks: 12,50,000 -> 12.5L, 4500 -> 4.5K (Indian units). */
export function compactINR(v: number): string {
  if (Math.abs(v) >= 1e7) return `${(v / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(v));
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({ active, payload, label, format = defaultFormat }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number; format?: Formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-xs shadow-pop">
      {label != null && <p className="mb-1 font-medium text-ink">{label}</p>}
      {payload.map((entry) => (
        <p key={String(entry.dataKey ?? entry.name)} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: entry.color ?? (entry.payload?.color as string) }} aria-hidden />
            {entry.name}
          </span>
          <span className="tabular font-medium text-ink">{format(Number(entry.value ?? 0))}</span>
        </p>
      ))}
    </div>
  );
}

const legendProps = {
  iconType: "square" as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, paddingTop: 6 },
  formatter: (value: string) => <span style={{ color: "#45556c" }}>{value}</span>,
};

export function ChartCard({
  title, description, action, height = 260, empty, children, className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  height?: number;
  /** When true, an empty state replaces the plot. */
  empty?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <div className="px-2 pb-2 pt-3" style={{ height }}>
        {empty ? <EmptyState title="No data for this period" description="Try a wider date range." className="h-full py-0" /> : children}
      </div>
    </Card>
  );
}

interface CartesianProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  format?: Formatter;
  tickFormat?: Formatter;
}

export function BarSeriesChart({ data, xKey, series, format, tickFormat, stacked, horizontal }: CartesianProps & { stacked?: boolean; horizontal?: boolean }) {
  const last = series.length - 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 12, left: horizontal ? 8 : -8, bottom: 0 }} barCategoryGap="28%" barGap={2}>
        <CartesianGrid stroke={GRID} vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tickFormat} allowDecimals={false} />
            <YAxis type="category" dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tickFormat} allowDecimals={false} width={44} />
          </>
        )}
        <Tooltip cursor={{ fill: "#f1f4f8" }} content={<ChartTooltip format={format} />} />
        {series.length > 1 && <Legend {...legendProps} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            stackId={stacked ? "stack" : undefined}
            maxBarSize={28}
            // Surface-coloured stroke leaves a 2px gap between stacked segments.
            stroke={stacked ? SURFACE : undefined}
            strokeWidth={stacked ? 2 : 0}
            radius={!stacked || i === last ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineSeriesChart({ data, xKey, series, format, tickFormat }: CartesianProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tickFormat} allowDecimals={false} width={44} />
        <Tooltip cursor={{ stroke: "#cdd5df" }} content={<ChartTooltip format={format} />} />
        {series.length > 1 && <Legend {...legendProps} iconType="plainline" iconSize={12} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={data.length <= 16 ? { r: 3, strokeWidth: 2, stroke: SURFACE, fill: s.color } : false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: SURFACE }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AreaSeriesChart({ data, xKey, series, format, tickFormat }: CartesianProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={tickFormat} width={44} />
        <Tooltip cursor={{ stroke: "#cdd5df" }} content={<ChartTooltip format={format} />} />
        {series.length > 1 && <Legend {...legendProps} />}
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Part-to-whole with few categories. The legend carries labels and values, so colour is never the only cue. */
export function DonutChart({ data, format = defaultFormat, centerLabel }: { data: Slice[]; format?: Formatter; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex h-full flex-col items-center gap-3 sm:flex-row sm:gap-2">
      <div className="relative h-full min-h-36 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke={SURFACE} strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip format={format} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="tabular text-xl font-semibold leading-none text-ink">{format(total)}</p>
            {centerLabel && <p className="mt-1 text-[11px] text-ink-3">{centerLabel}</p>}
          </div>
        </div>
      </div>
      <ul className="w-full shrink-0 space-y-1.5 px-2 sm:w-44">
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: d.color }} aria-hidden />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="tabular shrink-0 font-medium text-ink">
              {format(d.value)}
              <span className="ml-1 font-normal text-ink-3">{total > 0 ? `${Math.round((d.value / total) * 100)}%` : ""}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Thin progress meter for rates and scores (0..100). */
export function Meter({ value, color = SERIES[0], label }: { value: number | null; color?: string; label?: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
