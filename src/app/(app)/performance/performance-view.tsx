"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, Download, Medal, Trophy } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, errorMessage, useQuery } from "@/lib/client";
import { formatDuration, formatKm, formatPercent } from "@/lib/format";
import type { leaderboard } from "@/server/services/performance";
import { BarSeriesChart, ChartCard, Meter, SERIES } from "@/components/app/charts";
import { DataTable } from "@/components/app/data-table";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { useRange } from "@/components/app/range-picker";
import { ScoringNote } from "@/components/app/scoring-note";
import { StatusBadge } from "@/components/app/status-badge";
import { TrendCell } from "@/components/app/trend";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";

type Board = Awaited<ReturnType<typeof leaderboard>>;
type Row = Board["rows"][number];

const METRICS = [
  { value: "score", label: "Performance score", get: (r: Row) => r.stats.score ?? 0, format: (v: number) => v.toFixed(1) },
  { value: "delivered", label: "Completed deliveries", get: (r: Row) => r.stats.delivered, format: (v: number) => String(v) },
  { value: "onTime", label: "On-time rate (%)", get: (r: Row) => Math.round((r.stats.onTimeRate ?? 0) * 1000) / 10, format: (v: number) => `${v}%` },
  { value: "success", label: "Success rate (%)", get: (r: Row) => Math.round((r.stats.successRate ?? 0) * 1000) / 10, format: (v: number) => `${v}%` },
  { value: "distance", label: "Distance (km)", get: (r: Row) => r.stats.distanceKm, format: (v: number) => `${v} km` },
] as const;

const PODIUM = [
  { icon: Trophy, tone: "bg-warning-soft text-warning" },
  { icon: Medal, tone: "bg-neutral-soft text-ink-2" },
  { icon: Award, tone: "bg-primary-soft text-primary" },
];

export function PerformanceView() {
  const can = useCan();
  const router = useRouter();
  const range = useRange("6m");
  const { data, loading, error, reload } = useQuery<Board>(`/api/performance?${range.query}`);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["value"]>("score");

  const exportCsv = async () => {
    try {
      toast.success(`Downloaded ${await downloadFile(`/api/reports/drivers?${range.query}`)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const header = (
    <PageHeader
      title="Driver Performance"
      description="Leaderboard and comparison, based on closed deliveries in the selected period."
      actions={
        <>
          {range.picker}
          {can("reports:export") && <Button variant="secondary" onClick={exportCsv}><Download />Export CSV</Button>}
        </>
      }
    />
  );
  if (error) return <>{header}<Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !data) return <>{header}<LoadingState /></>;

  const rated = data.rows.filter((r) => r.rank != null);
  const m = METRICS.find((x) => x.value === metric)!;
  const comparison = [...data.rows]
    .filter((r) => r.stats.delivered + r.stats.failed > 0)
    .sort((a, b) => m.get(b) - m.get(a))
    .slice(0, 12)
    .map((r) => ({ name: r.driver.fullName, value: m.get(r) }));

  return (
    <>
      {header}
      {rated.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {rated.slice(0, 3).map((r, i) => {
            const Icon = PODIUM[i].icon;
            return (
              <Link key={r.driver.id} href={`/performance/${r.driver.id}`} className="block">
                <Card className="flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-full ${PODIUM[i].tone}`}><Icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-3">Rank {r.rank}</p>
                    <p className="truncate text-sm font-semibold text-ink">{r.driver.fullName}</p>
                    <p className="text-xs text-ink-3">{r.stats.delivered} delivered · {formatPercent(r.stats.onTimeRate)} on time</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-2xl font-semibold leading-none text-ink">{r.stats.score!.toFixed(1)}</p>
                    <p className="mt-1 text-[11px] text-ink-3">score / 100</p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Card className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 text-[13px]">
        <span className="font-semibold text-ink">Fleet benchmark</span>
        <span className="text-ink-2">On-time rate <strong className="tabular font-semibold text-ink">{formatPercent(data.fleet.onTimeRate)}</strong></span>
        <span className="text-ink-2">Success rate <strong className="tabular font-semibold text-ink">{formatPercent(data.fleet.successRate)}</strong></span>
        <span className="text-ink-2">Completion rate <strong className="tabular font-semibold text-ink">{formatPercent(data.fleet.completionRate)}</strong></span>
        <span className="text-ink-2">Avg duration <strong className="tabular font-semibold text-ink">{formatDuration(data.fleet.avgDurationMin)}</strong></span>
        <span className="text-ink-2">Deliveries per driver <strong className="tabular font-semibold text-ink">{data.fleet.deliveredPerDriver ?? "—"}</strong></span>
        <span className="text-xs text-ink-3">Every driver below is measured against these fleet-wide figures for the same period.</span>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Leaderboard" description={`${rated.length} rated driver${rated.length === 1 ? "" : "s"} · ${data.rows.length - rated.length} not yet rated`} />
          <DataTable
            caption="Driver leaderboard"
            rows={data.rows}
            rowKey={(r) => r.driver.id}
            onRowClick={(r) => router.push(`/performance/${r.driver.id}`)}
            empty={{ title: "No drivers found" }}
            columns={[
              { key: "rank", header: "Rank", className: "w-12", render: (r) => <span className="tabular font-semibold text-ink">{r.rank ?? "—"}</span> },
              { key: "driver", header: "Driver", render: (r) => <div><p className="whitespace-nowrap font-medium text-primary">{r.driver.fullName}</p><p className="text-xs text-ink-3">{r.driver.code}</p></div> },
              { key: "status", header: "Status", hideBelow: "lg", render: (r) => <StatusBadge status={r.driver.status} /> },
              { key: "delivered", header: "Completed", align: "right", render: (r) => <span className="tabular">{r.stats.delivered}</span> },
              { key: "failed", header: "Failed", align: "right", hideBelow: "sm", render: (r) => <span className="tabular">{r.stats.failed}</span> },
              { key: "completion", header: "Completion", align: "right", hideBelow: "xl", render: (r) => <span className="tabular">{formatPercent(r.stats.completionRate)}</span> },
              { key: "success", header: "Success", align: "right", hideBelow: "md", render: (r) => <span className="tabular">{formatPercent(r.stats.successRate)}</span> },
              { key: "ontime", header: "On time", align: "right", render: (r) => <span className="tabular">{formatPercent(r.stats.onTimeRate)}</span> },
              { key: "trend", header: "30-day trend", hideBelow: "md", render: (r) => <TrendCell trend={r.trend} /> },
              { key: "duration", header: "Avg duration", align: "right", hideBelow: "lg", render: (r) => <span className="tabular">{formatDuration(r.stats.avgDurationMin)}</span> },
              { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (r) => <span className="tabular">{formatKm(r.stats.distanceKm)}</span> },
              {
                key: "score", header: "Score", className: "w-28",
                render: (r) => (r.stats.score == null ? <span className="text-xs text-ink-3">Not rated</span> : <div><span className="tabular text-[13px] font-semibold">{r.stats.score.toFixed(1)}</span><Meter value={r.stats.score} label={`${r.driver.fullName} score`} /></div>),
              },
            ]}
          />
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <ChartCard
            title="Performance comparison"
            description={m.label}
            height={Math.max(220, comparison.length * 30 + 40)}
            empty={comparison.length === 0}
            action={
              <Select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} aria-label="Comparison metric" className="h-8 w-48">
                {METRICS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </Select>
            }
          >
            <BarSeriesChart horizontal data={comparison} xKey="name" series={[{ key: "value", label: m.label, color: SERIES[0] }]} format={m.format} />
          </ChartCard>
          <ScoringNote scoring={data.scoring} />
        </div>
      </div>
    </>
  );
}
