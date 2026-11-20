"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Gauge, Route, Timer, XCircle } from "lucide-react";
import { useQuery } from "@/lib/client";
import { formatDate, formatDuration, formatKm, formatPercent } from "@/lib/format";
import type { driverPerformance } from "@/server/services/performance";
import { BarSeriesChart, ChartCard, LineSeriesChart, OUTCOME, SERIES } from "./charts";
import { DataTable } from "./data-table";
import { ErrorState, LoadingState, PageHeader, StatCard } from "./page";
import { useRange } from "./range-picker";
import { ScoringNote } from "./scoring-note";
import { StatusBadge } from "./status-badge";
import { TrendCell } from "./trend";
import { Meter } from "./charts";
import { Card, CardHeader } from "@/components/ui/card";

type Performance = Awaited<ReturnType<typeof driverPerformance>>;

/**
 * Individual driver performance profile. Used by managers (/performance/:id)
 * and by drivers for their own numbers (/my-performance, driverId = "me").
 */
export function DriverPerformance({ driverId, own = false }: { driverId: string; own?: boolean }) {
  const router = useRouter();
  const range = useRange("6m");
  const { data, loading, error, reload } = useQuery<Performance>(`/api/performance/${driverId}?${range.query}`);
  const back = own ? undefined : { href: "/performance", label: "Driver performance" };
  const title = own ? "My Performance" : (data?.driver.fullName ?? "Driver performance");

  if (error) return <><PageHeader title={title} back={back} actions={range.picker} /><Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !data) return <><PageHeader title={title} back={back} actions={range.picker} /><LoadingState /></>;

  const s = data.stats;
  return (
    <>
      <PageHeader
        back={back}
        title={<span className="flex flex-wrap items-center gap-2.5">{title}{!own && <StatusBadge status={data.driver.status} />}</span>}
        description={`${data.driver.code}${data.driver.vehicle ? ` · ${data.driver.vehicle.registrationNumber}` : ""} · deliveries scheduled ${range.phrase}`}
        actions={range.picker}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Performance score"
          value={s.score != null ? s.score.toFixed(1) : "Not rated"}
          hint={data.rank ? `Rank ${data.rank} of ${data.ratedDrivers} rated drivers` : "Needs 3 closed deliveries"}
          icon={Gauge}
        />
        <StatCard label="Completed deliveries" value={s.delivered} hint={`${s.total} assigned in period`} icon={CheckCircle2} tone="success" />
        <StatCard label="On-time deliveries" value={s.onTime} hint={`${formatPercent(s.onTimeRate)} on-time rate`} icon={Clock} tone="warning" />
        <StatCard label="Failed deliveries" value={s.failed} hint={`${formatPercent(s.successRate)} success rate`} icon={XCircle} tone={s.failed ? "danger" : "neutral"} />
        <StatCard label="Total distance" value={formatKm(s.distanceKm)} hint="Delivered jobs" icon={Route} tone="violet" />
        <StatCard label="Avg delivery duration" value={formatDuration(s.avgDurationMin)} hint="Pickup to delivery" icon={Timer} tone="neutral" />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Compared with the fleet"
          description="This driver against the fleet-wide figure for the same period"
          action={<span className="flex items-center gap-2 text-xs text-ink-3">30-day trend <TrendCell trend={data.trend} /></span>}
        />
        <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "On-time rate", own: s.onTimeRate, fleet: data.fleet.onTimeRate },
            { label: "Success rate", own: s.successRate, fleet: data.fleet.successRate },
            { label: "Completion rate", own: s.completionRate, fleet: data.fleet.completionRate },
          ].map((m) => {
            const diff = m.own != null && m.fleet != null ? Math.round((m.own - m.fleet) * 100) : null;
            return (
              <div key={m.label}>
                <p className="flex items-baseline justify-between text-xs text-ink-3">
                  {m.label}
                  {diff != null && (
                    <span className={diff > 0 ? "font-medium text-success" : diff < 0 ? "font-medium text-danger" : "text-ink-3"}>
                      {diff === 0 ? "at fleet level" : `${diff > 0 ? "+" : ""}${diff} pts vs fleet`}
                    </span>
                  )}
                </p>
                <p className="tabular mt-0.5 text-lg font-semibold text-ink">{formatPercent(m.own)}</p>
                <Meter value={m.own == null ? null : m.own * 100} label={m.label} />
                <p className="mt-1 text-xs text-ink-3">Fleet: {formatPercent(m.fleet)}</p>
              </div>
            );
          })}
          <div>
            <p className="text-xs text-ink-3">Average delivery duration</p>
            <p className="tabular mt-0.5 text-lg font-semibold text-ink">{formatDuration(s.avgDurationMin)}</p>
            <p className="mt-1 text-xs text-ink-3">Fleet: {formatDuration(data.fleet.avgDurationMin)} · {data.fleet.deliveredPerDriver ?? "—"} deliveries per driver</p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Deliveries by outcome" description="Per month" empty={data.monthly.length === 0}>
          <BarSeriesChart
            stacked
            data={data.monthly}
            xKey="label"
            series={[
              { key: "onTime", label: "On time", color: OUTCOME.good },
              { key: "late", label: "Late", color: OUTCOME.warning },
              { key: "failed", label: "Failed", color: OUTCOME.critical },
            ]}
          />
        </ChartCard>
        <ChartCard title="Success and on-time rate" description="Per month (%)" empty={data.monthly.length === 0}>
          <LineSeriesChart
            data={data.monthly}
            xKey="label"
            format={(v) => `${v}%`}
            series={[
              { key: "successRate", label: "Success rate", color: SERIES[0] },
              { key: "onTimeRate", label: "On-time rate", color: SERIES[1] },
            ]}
          />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Delivery history" description={`Latest ${data.deliveries.length} deliveries in the period`} />
          <DataTable
            rows={data.deliveries}
            rowKey={(d) => d.id}
            onRowClick={(d) => router.push(`/deliveries/${d.id}`)}
            empty={{ title: "No deliveries in this period", description: "Try a wider date range." }}
            columns={[
              { key: "code", header: "Delivery", render: (d) => <span className="font-medium text-primary">{d.code}</span> },
              { key: "customer", header: "Customer", hideBelow: "sm", render: (d) => d.customerName },
              { key: "dest", header: "Destination", hideBelow: "lg", render: (d) => <span className="text-ink-2">{d.destinationAddress}</span> },
              { key: "date", header: "Scheduled", render: (d) => formatDate(d.scheduledAt) },
              { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (d) => <span className="tabular">{formatKm(d.distanceKm)}</span> },
              {
                key: "timing", header: "Timing", hideBelow: "sm",
                render: (d) => {
                  if (d.status !== "DELIVERED" || !d.deliveredAt) return "—";
                  const onTime = new Date(d.deliveredAt) <= new Date(d.expectedAt);
                  return <StatusBadge status={onTime ? "DELIVERED" : "DELAYED"} label={onTime ? "On time" : "Late"} />;
                },
              },
              { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
            ]}
          />
        </Card>
        <ScoringNote scoring={data.scoring} />
      </div>
    </>
  );
}
