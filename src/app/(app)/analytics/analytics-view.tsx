"use client";

import { useState } from "react";
import { BarChart3, CheckCircle2, Clock, Fuel, Gauge, IndianRupee, Lightbulb, Package, Route, Timer, Truck, Users, Wrench } from "lucide-react";
import { useQuery } from "@/lib/client";
import type { Delta } from "@/lib/domain/compare";
import { formatDate, formatDuration, formatINR, formatKm } from "@/lib/format";
import type { getAnalytics } from "@/server/services/analytics";
import { BarSeriesChart, ChartCard, compactINR, DonutChart, LineSeriesChart, OUTCOME, SERIES } from "@/components/app/charts";
import { DashboardSkeleton, ErrorState, PageHeader, StatCard, type StatDelta } from "@/components/app/page";
import { useRange } from "@/components/app/range-picker";
import { STATUS_COLORS } from "@/components/app/status-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DriversTab, FleetTab, FuelTab, MaintenanceTab } from "./analytics-tabs";

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
const pctText = (v: number | null) => (v == null ? "—" : `${v}%`);

/** Relative change, for counts and amounts. */
const rel = (d: Delta | undefined, goodWhen: "up" | "down"): StatDelta | null => (d && d.change != null ? { pct: d.pct, goodWhen } : null);
/** Change in percentage points, for metrics that are already percentages. */
const pts = (d: Delta | undefined, goodWhen: "up" | "down"): StatDelta | null => (d && d.change != null ? { pct: null, points: d.change, goodWhen } : null);

function SectionTitle({ icon: Icon, title, description }: { icon: typeof Gauge; title: string; description: string }) {
  return (
    <div className="mb-2.5 mt-6 flex items-center gap-2 first:mt-0">
      <Icon className="size-4 text-primary" aria-hidden />
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <span className="hidden text-xs text-ink-3 sm:inline">· {description}</span>
    </div>
  );
}

function Overview({ data, comparing }: { data: Analytics; comparing: boolean }) {
  const s = data.summary;
  const d = data.deltas;
  const unit = data.unit;
  const p = data.productivity;

  return (
    <>
      {comparing && data.comparison && (
        <Card className="mb-5">
          <CardHeader
            title="What changed"
            description={`Compared with ${formatDate(data.comparison.range.from)} – ${formatDate(data.comparison.range.to)} (${data.comparison.mode === "year" ? "same period last year" : "previous period"})`}
          />
          <ul className="space-y-2 p-4">
            {data.insights.map((text) => (
              <li key={text} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionTitle icon={CheckCircle2} title="Delivery reliability" description="Did deliveries arrive, and on time?" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total deliveries" value={s.totalDeliveries} hint={`${s.delivered} delivered · ${s.inProgress} open`} icon={Package} delta={rel(d?.totalDeliveries, "up")} />
        <StatCard label="Delivery success rate" value={pctText(s.successRate)} hint={`${s.failed} failed · ${s.cancelled} cancelled`} icon={CheckCircle2} tone="success" delta={pts(d?.successRate, "up")} />
        <StatCard label="On-time delivery" value={pctText(s.onTimeRate)} hint="Delivered by the expected time" icon={Clock} tone="warning" delta={pts(d?.onTimeRate, "up")} />
        <StatCard label="Average delivery duration" value={formatDuration(s.avgDurationMin)} hint="Pickup to delivery" icon={Timer} tone="violet" delta={rel(d?.avgDurationMin, "down")} />
      </div>

      <SectionTitle icon={IndianRupee} title="Operational cost" description="What it cost to run the fleet" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Fuel expenditure" value={formatINR(s.fuelCostPaise)} icon={Fuel} tone="warning" delta={rel(d?.fuelCostPaise, "down")} />
        <StatCard label="Maintenance expenditure" value={formatINR(s.maintenanceCostPaise)} hint="Completed jobs" icon={Wrench} tone="neutral" delta={rel(d?.maintenanceCostPaise, "down")} />
        <StatCard label="Cost per delivery" value={formatINR(s.costPerDeliveryPaise)} hint="(Fuel + maintenance) ÷ delivered" icon={IndianRupee} tone="violet" delta={rel(d?.costPerDeliveryPaise, "down")} />
        <StatCard label="Total operating cost" value={formatINR(s.fuelCostPaise + s.maintenanceCostPaise)} hint="Fuel + maintenance" icon={BarChart3} />
      </div>

      <SectionTitle icon={Truck} title="Fleet efficiency and driver productivity" description="How hard the fleet and the team worked" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Fleet utilisation" value={pctText(s.fleetUtilization)} hint={`${s.vehiclesUsed} of ${s.fleetSize} vehicles used`} icon={Truck} delta={pts(d?.fleetUtilization, "up")} />
        <StatCard label="Distance covered" value={formatKm(s.distanceKm)} hint="Delivered jobs" icon={Route} tone="neutral" delta={rel(d?.distanceKm, "up")} />
        <StatCard label="Deliveries per driver" value={p.deliveredPerDriver ?? "—"} hint={`${p.activeDrivers} driver${p.activeDrivers === 1 ? "" : "s"} worked in the period`} icon={Users} tone="success" />
        <StatCard label="Distance per delivery" value={formatKm(p.kmPerDelivery)} hint={p.kmPerDriver != null ? `${formatKm(p.kmPerDriver)} per driver` : undefined} icon={Gauge} tone="violet" />
      </div>

      <section className="mt-5 grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title={unit === "month" ? "Monthly delivery trends" : `Delivery trends per ${unit}`} description="Deliveries scheduled vs. delivered" empty={s.totalDeliveries === 0}>
          <LineSeriesChart
            data={data.timeline}
            xKey="label"
            series={[
              { key: "total", label: "Scheduled", color: SERIES[0] },
              { key: "delivered", label: "Delivered", color: SERIES[2] },
            ]}
          />
        </ChartCard>
        <ChartCard title="Delivery status distribution" description="All deliveries scheduled in the period" empty={s.totalDeliveries === 0}>
          <DonutChart centerLabel="deliveries" data={data.statusDistribution.map((x) => ({ label: x.label, value: x.count, color: STATUS_COLORS[x.status] }))} />
        </ChartCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title={unit === "day" ? "Daily delivery performance" : `Delivery performance per ${unit}`} description="Closed deliveries by outcome" empty={s.delivered + s.failed === 0}>
          <BarSeriesChart
            stacked
            data={data.timeline}
            xKey="label"
            series={[
              { key: "onTime", label: "On time", color: OUTCOME.good },
              { key: "late", label: "Late", color: OUTCOME.warning },
              { key: "failed", label: "Failed", color: OUTCOME.critical },
            ]}
          />
        </ChartCard>
        <ChartCard title="Operating cost over time" description={`Fuel and completed maintenance per ${unit} (₹)`} empty={s.fuelCostPaise + s.maintenanceCostPaise === 0}>
          <BarSeriesChart
            stacked
            data={data.timeline}
            xKey="label"
            series={[
              { key: "fuelCost", label: "Fuel", color: SERIES[0] },
              { key: "maintenanceCost", label: "Maintenance", color: SERIES[1] },
            ]}
            format={(v) => formatINR(v * 100)}
            tickFormat={compactINR}
          />
        </ChartCard>
      </section>
    </>
  );
}

export function AnalyticsView() {
  const range = useRange("month", { compare: "previous" });
  const [tab, setTab] = useState("overview");
  const { data, loading, error, reload } = useQuery<Analytics>(`/api/analytics?${range.compareQuery}`);

  return (
    <>
      <PageHeader title="Analytics" description="Reliability, cost and efficiency, calculated from delivery, fuel and maintenance records." actions={range.picker} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview"><BarChart3 />Overview</TabsTrigger>
          <TabsTrigger value="fleet"><Truck />Fleet efficiency</TabsTrigger>
          <TabsTrigger value="fuel"><Fuel />Fuel efficiency</TabsTrigger>
          <TabsTrigger value="maintenance"><Wrench />Maintenance</TabsTrigger>
          <TabsTrigger value="drivers"><Users />Drivers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {error ? (
            <Card><ErrorState message={error} onRetry={reload} /></Card>
          ) : loading || !data ? (
            <DashboardSkeleton cards={8} />
          ) : (
            <Overview data={data} comparing={range.comparison !== "none"} />
          )}
        </TabsContent>
        {/* The other tabs load their own data the first time they are opened. */}
        <TabsContent value="fleet">{tab === "fleet" && <FleetTab query={range.query} />}</TabsContent>
        <TabsContent value="fuel">{tab === "fuel" && <FuelTab query={range.query} />}</TabsContent>
        <TabsContent value="maintenance">{tab === "maintenance" && <MaintenanceTab analytics={data} query={range.query} />}</TabsContent>
        <TabsContent value="drivers">{tab === "drivers" && <DriversTab analytics={data} query={range.query} />}</TabsContent>
      </Tabs>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
        <Gauge className="size-3.5" aria-hidden />
        All figures are calculated live from database records for the selected period ({formatDate(range.from)} – {formatDate(range.to)}).
      </p>
    </>
  );
}
