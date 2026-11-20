"use client";

import Link from "next/link";
import { AlertTriangle, CalendarX, Download, Fuel, Gauge, IndianRupee, ParkingCircle, Route, TrendingDown, Truck, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, errorMessage, useQuery } from "@/lib/client";
import { formatDate, formatINR, formatKm, formatNumber, formatPercent } from "@/lib/format";
import type { fleetIntelligence } from "@/server/services/intelligence";
import { BarSeriesChart, ChartCard, compactINR, LineSeriesChart, Meter, OUTCOME, SERIES } from "@/components/app/charts";
import { DataTable } from "@/components/app/data-table";
import { FuelFlagsCard, ServiceRecommendationsCard, SystemTag, type FuelIntel } from "@/components/app/intelligence";
import { DashboardSkeleton, EmptyState, ErrorState, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import type { Analytics } from "./analytics-view";

type FleetIntel = Awaited<ReturnType<typeof fleetIntelligence>>;
const pct1 = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

function ExportButton({ type, query }: { type: string; query: string }) {
  const can = useCan();
  if (!can("reports:export")) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          toast.success(`Downloaded ${await downloadFile(`/api/reports/${type}?${query}`)}`);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }}
    >
      <Download />
      CSV
    </Button>
  );
}

// --- Fleet efficiency -------------------------------------------------------------

export function FleetTab({ query }: { query: string }) {
  const { data, loading, error, reload } = useQuery<FleetIntel>(`/api/intelligence/fleet?${query}`);
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (loading || !data) return <DashboardSkeleton />;
  const f = data.fleet;
  const under = data.vehicles.filter((v) => v.underutilized);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Vehicle utilisation" value={pct1(f.utilization)} hint="Active days ÷ available days" icon={Gauge} />
        <StatCard label="Idle time" value={pct1(f.idle)} hint="Available days with no delivery" icon={ParkingCircle} tone="neutral" />
        <StatCard label="Active vehicles" value={pct1(f.activeVehicleShare)} hint={`${pct1(f.idleVehicleShare)} never used in the period`} icon={Truck} tone="success" />
        <StatCard label="Maintenance downtime" value={`${f.downtimeDays} day${f.downtimeDays === 1 ? "" : "s"}`} hint={`${pct1(f.downtimeShare)} of vehicle-days`} icon={Wrench} tone="warning" />
        <StatCard label="Avg distance per vehicle" value={formatKm(f.avgDistancePerVehicle)} hint={`${formatKm(f.distanceKm)} in total`} icon={Route} tone="violet" />
        <StatCard label="Under-utilised vehicles" value={f.underutilizedCount} hint={`of ${f.operationalVehicles} operational`} icon={TrendingDown} tone={f.underutilizedCount ? "danger" : "neutral"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Vehicle usage trend" description="Vehicles with at least one delivery, per week" empty={data.trend.every((t) => t.vehiclesUsed === 0)}>
          <BarSeriesChart data={data.trend} xKey="label" series={[{ key: "vehiclesUsed", label: "Vehicles used", color: SERIES[0] }]} />
        </ChartCard>
        <Card role="region" aria-label="Under-utilised vehicles">
          <CardHeader title="Under-utilised vehicles" description={`Available ${data.rules.minDays}+ days and well below the fleet average, or not used at all`} action={<SystemTag />} />
          {under.length === 0 ? (
            <EmptyState icon={Truck} title="No under-utilised vehicles" description="Every operational vehicle was used in line with the rest of the fleet." className="py-10" />
          ) : (
            <ul className="scroll-thin max-h-[268px] divide-y divide-line overflow-y-auto" tabIndex={0} aria-label="Under-utilised vehicles list">
              {under.map((v) => (
                <li key={v.vehicleId} className="flex gap-3 px-4 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      <Link href={`/vehicles/${v.vehicleId}`} className="text-primary hover:underline">{v.registrationNumber}</Link>
                      <span className="ml-2 text-xs font-normal text-ink-3">{v.name} · {v.typeLabel}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{v.explanation}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Utilisation by vehicle" description="Least used first. Downtime days are excluded from available days." action={<ExportButton type="vehicles" query={query} />} />
        <DataTable
          caption="Utilisation by vehicle"
          rows={data.vehicles}
          rowKey={(v) => v.vehicleId}
          empty={{ title: "No operational vehicles" }}
          columns={[
            { key: "vehicle", header: "Vehicle", render: (v) => <div><Link href={`/vehicles/${v.vehicleId}`} className="whitespace-nowrap font-medium text-primary hover:underline">{v.registrationNumber}</Link><p className="text-xs text-ink-3">{v.typeLabel}</p></div> },
            { key: "driver", header: "Driver", hideBelow: "lg", render: (v) => v.driver ?? <span className="text-ink-3">Unassigned</span> },
            { key: "active", header: "Active days", align: "right", render: (v) => <span className="tabular">{v.activeDays}<span className="text-ink-3"> / {v.availableDays}</span></span> },
            { key: "downtime", header: "Downtime", align: "right", hideBelow: "md", render: (v) => <span className="tabular">{v.downtimeDays} d</span> },
            { key: "deliveries", header: "Deliveries", align: "right", hideBelow: "sm", render: (v) => <span className="tabular">{v.deliveries}</span> },
            { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (v) => <span className="tabular">{formatKm(v.distanceKm)}</span> },
            { key: "last", header: "Last used", hideBelow: "lg", render: (v) => (v.lastUsedAt ? formatDate(v.lastUsedAt) : "—") },
            {
              key: "util", header: "Utilisation", className: "w-36",
              render: (v) => (
                <div>
                  <span className="tabular text-xs">{pct1(v.utilization)}</span>
                  <Meter value={v.utilization * 100} color={v.underutilized ? OUTCOME.warning : SERIES[0]} label={`${v.registrationNumber} utilisation`} />
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

// --- Fuel efficiency --------------------------------------------------------------

export function FuelTab({ query }: { query: string }) {
  const intel = useQuery<FuelIntel>(`/api/intelligence/fuel?${query}`);
  const data = intel.data;
  if (intel.error) return <Card><ErrorState message={intel.error} onRetry={intel.reload} /></Card>;
  if (intel.loading || !data) return <DashboardSkeleton cards={4} />;
  const s = data.summary;
  const measured = data.vehicles.filter((v) => v.mileageKmPerL != null).sort((a, b) => b.mileageKmPerL! - a.mileageKmPerL!);
  const trend = data.trend.map((t) => ({
    label: new Date(`${t.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    price: t.avgPricePaise == null ? null : Math.round(t.avgPricePaise) / 100,
    costPerKm: t.costPerKmPaise == null ? null : Math.round(t.costPerKmPaise) / 100,
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Fleet mileage" value={s.fleetMileageKmPerL ? `${s.fleetMileageKmPerL.toFixed(1)} km/L` : "—"} hint={`${s.vehiclesMeasured} of ${s.vehiclesAnalysed} vehicles measurable`} icon={Gauge} tone="success" />
        <StatCard label="Fuel expenditure" value={formatINR(s.totalCostPaise)} hint="In the selected period" icon={IndianRupee} tone="warning" />
        <StatCard label="Efficiency concerns" value={s.poorMileage + s.mileageDrops + s.highCost} hint={`${s.mileageDrops} mileage drop · ${s.poorMileage} poor · ${s.highCost} high cost`} icon={TrendingDown} tone={s.poorMileage + s.mileageDrops + s.highCost ? "danger" : "neutral"} />
        <StatCard label="Incomplete records" value={s.incomplete} hint="Not enough data to judge" icon={CalendarX} tone="neutral" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Fuel efficiency comparison" description="km per litre by vehicle (fill-to-fill, valid intervals only)" height={Math.max(240, measured.length * 26 + 50)} empty={measured.length === 0}>
          <BarSeriesChart
            horizontal
            data={measured.map((v) => ({ name: v.registrationNumber, kmPerL: Math.round(v.mileageKmPerL! * 10) / 10 }))}
            xKey="name"
            series={[{ key: "kmPerL", label: "km/L", color: SERIES[0] }]}
            format={(v) => `${v} km/L`}
          />
        </ChartCard>
        <div className="space-y-4">
          <FuelFlagsCard data={data} loading={intel.loading} error={intel.error} onRetry={intel.reload} />
          <ChartCard title="Fuel cost trend" description="Fuel cost per km by month (₹)" height={200} empty={trend.every((t) => t.costPerKm == null)}>
            <LineSeriesChart data={trend} xKey="label" series={[{ key: "costPerKm", label: "₹ per km", color: SERIES[1] }]} format={(v) => `₹${v.toFixed(2)}`} />
          </ChartCard>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Mileage by vehicle" description="Recent = last two fills; earlier = the fills before them. Shown only when there are at least four valid intervals." action={<ExportButton type="fuel-efficiency" query={query} />} />
        <DataTable
          caption="Mileage by vehicle"
          rows={data.vehicles}
          rowKey={(v) => v.vehicleId}
          empty={{ title: "No fuel-powered vehicles" }}
          columns={[
            { key: "vehicle", header: "Vehicle", render: (v) => <div><Link href={`/vehicles/${v.vehicleId}`} className="whitespace-nowrap font-medium text-primary hover:underline">{v.registrationNumber}</Link><p className="text-xs text-ink-3">{v.groupLabel}</p></div> },
            { key: "fills", header: "Fills", align: "right", render: (v) => <span className="tabular">{v.fillCount}</span> },
            { key: "mileage", header: "km/L", align: "right", render: (v) => (v.mileageKmPerL == null ? <span className="text-xs text-ink-3">Not enough data</span> : <span className="tabular font-medium">{v.mileageKmPerL.toFixed(1)}</span>) },
            { key: "peer", header: "Peer median", align: "right", hideBelow: "md", render: (v) => (v.peerMedianMileage == null ? "—" : <span className="tabular">{v.peerMedianMileage.toFixed(1)}</span>) },
            {
              key: "change", header: "Recent change", align: "right", hideBelow: "sm",
              render: (v) =>
                v.mileageChange == null ? "—" : (
                  <span className={`tabular ${v.mileageChange <= -0.15 ? "font-medium text-danger" : v.mileageChange >= 0.05 ? "text-success" : "text-ink-2"}`}>
                    {v.mileageChange > 0 ? "+" : ""}{Math.round(v.mileageChange * 100)}%
                  </span>
                ),
            },
            { key: "cpk", header: "₹ / km", align: "right", hideBelow: "md", render: (v) => (v.costPerKmPaise == null ? "—" : <span className="tabular">{(v.costPerKmPaise / 100).toFixed(2)}</span>) },
            { key: "spend", header: "Spend", align: "right", hideBelow: "lg", render: (v) => <span className="tabular">{formatINR(v.totalCostPaise)}</span> },
            { key: "flags", header: "Flags", align: "right", render: (v) => (v.flags.length ? <span className="tabular font-medium text-warning">{v.flags.length}</span> : <span className="text-ink-3">None</span>) },
          ]}
        />
        {data.electric.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
            <Fuel className="mr-1 inline size-3.5" aria-hidden />
            Electric vehicles are not included in mileage analysis: {data.electric.map((e) => e.registrationNumber).join(", ")}.
          </p>
        )}
      </Card>
      <ChartCard className="mt-4" title="Fuel price trend" description="Average price paid per litre by month (₹)" height={220} empty={trend.every((t) => t.price == null)}>
        <LineSeriesChart data={trend} xKey="label" series={[{ key: "price", label: "₹ per litre", color: SERIES[0] }]} format={(v) => `₹${v.toFixed(2)}`} />
      </ChartCard>
    </>
  );
}

// --- Maintenance cost analysis ----------------------------------------------------

export function MaintenanceTab({ analytics, query }: { analytics: Analytics | null; query: string }) {
  if (!analytics) return <DashboardSkeleton cards={3} />;
  const s = analytics.summary;
  const byType = analytics.maintenanceByType;
  const byVehicle = analytics.vehicles.filter((v) => v.maintenanceCostPaise > 0).sort((a, b) => b.maintenanceCostPaise - a.maintenanceCostPaise);
  const jobs = byType.reduce((n, t) => n + t.count, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Maintenance expenditure" value={formatINR(s.maintenanceCostPaise)} hint={`${jobs} completed job${jobs === 1 ? "" : "s"}`} icon={Wrench} tone="warning" />
        <StatCard label="Average cost per job" value={jobs ? formatINR(Math.round(s.maintenanceCostPaise / jobs)) : "—"} icon={IndianRupee} tone="violet" />
        <StatCard label="Maintenance per km" value={s.distanceKm > 0 ? formatINR(Math.round(s.maintenanceCostPaise / s.distanceKm), true) : "—"} hint="Spend ÷ delivered distance" icon={Route} tone="neutral" />
        <StatCard label="Largest cost type" value={byType[0]?.label ?? "—"} hint={byType[0] ? `${formatINR(byType[0].costPaise)} · ${byType[0].count} job${byType[0].count === 1 ? "" : "s"}` : undefined} icon={Gauge} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Maintenance cost by type" description="Completed jobs in the period (₹)" empty={byType.length === 0}>
          <BarSeriesChart
            horizontal
            data={byType.map((t) => ({ name: t.label, cost: Math.round(t.costPaise / 100) }))}
            xKey="name"
            series={[{ key: "cost", label: "Cost", color: SERIES[1] }]}
            format={(v) => formatINR(v * 100)}
            tickFormat={compactINR}
          />
        </ChartCard>
        <ChartCard title="Maintenance cost over time" description={`Completed maintenance per ${analytics.unit} (₹)`} empty={s.maintenanceCostPaise === 0}>
          <BarSeriesChart data={analytics.timeline} xKey="label" series={[{ key: "maintenanceCost", label: "Maintenance cost", color: SERIES[1] }]} format={(v) => formatINR(v * 100)} tickFormat={compactINR} />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Maintenance cost by vehicle" description="Completed jobs in the period" action={<ExportButton type="maintenance" query={query} />} />
          <DataTable
            caption="Maintenance cost by vehicle"
            rows={byVehicle}
            rowKey={(v) => v.id}
            empty={{ title: "No completed maintenance in this period" }}
            columns={[
              { key: "vehicle", header: "Vehicle", render: (v) => <Link href={`/vehicles/${v.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">{v.registrationNumber}</Link> },
              { key: "cost", header: "Maintenance", align: "right", render: (v) => <span className="tabular font-medium">{formatINR(v.maintenanceCostPaise)}</span> },
              { key: "fuel", header: "Fuel", align: "right", hideBelow: "sm", render: (v) => <span className="tabular">{formatINR(v.fuelCostPaise)}</span> },
              { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (v) => <span className="tabular">{formatKm(v.distanceKm)}</span> },
              { key: "perkm", header: "₹ / km", align: "right", render: (v) => (v.distanceKm > 0 ? <span className="tabular">{((v.maintenanceCostPaise + v.fuelCostPaise) / 100 / v.distanceKm).toFixed(2)}</span> : "—") },
            ]}
          />
        </Card>
        <ServiceRecommendationsCard />
      </div>
    </>
  );
}

// --- Driver productivity ----------------------------------------------------------

export function DriversTab({ analytics, query }: { analytics: Analytics | null; query: string }) {
  if (!analytics) return <DashboardSkeleton cards={4} />;
  const p = analytics.productivity;
  const s = analytics.summary;
  const working = analytics.drivers.filter((d) => d.delivered + d.failed > 0);
  const top = working.slice(0, 10);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Drivers who worked" value={p.activeDrivers} hint="At least one assigned delivery" icon={Users} />
        <StatCard label="Deliveries per driver" value={p.deliveredPerDriver ?? "—"} hint={`${s.delivered} delivered in total`} icon={Gauge} tone="success" />
        <StatCard label="Distance per driver" value={formatKm(p.kmPerDriver)} hint="Delivered distance" icon={Route} tone="violet" />
        <StatCard label="Fleet on-time rate" value={s.onTimeRate == null ? "—" : `${s.onTimeRate}%`} hint="The benchmark for each driver" icon={TrendingDown} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Driver performance comparison" description="Deliveries on time, late and failed" height={Math.max(240, top.length * 30 + 50)} empty={top.length === 0}>
          <BarSeriesChart
            stacked
            horizontal
            data={top.map((d) => ({ name: d.name, onTime: d.onTime, late: d.late, failed: d.failed }))}
            xKey="name"
            series={[
              { key: "onTime", label: "On time", color: OUTCOME.good },
              { key: "late", label: "Late", color: OUTCOME.warning },
              { key: "failed", label: "Failed", color: OUTCOME.critical },
            ]}
          />
        </ChartCard>
        <Card>
          <CardHeader title="Driver productivity" description="Ranked by score. Drivers with under 3 closed deliveries are not rated." action={<ExportButton type="drivers" query={query} />} />
          <DataTable
            caption="Driver productivity"
            rows={working}
            rowKey={(d) => d.id}
            empty={{ title: "No driver activity in this period" }}
            columns={[
              { key: "rank", header: "#", className: "w-8", render: (d) => <span className="tabular text-ink-3">{d.rank ?? "—"}</span> },
              { key: "driver", header: "Driver", render: (d) => <Link href={`/performance/${d.id}`} className="whitespace-nowrap font-medium text-primary hover:underline">{d.name}</Link> },
              { key: "delivered", header: "Delivered", align: "right", render: (d) => <span className="tabular">{d.delivered}</span> },
              { key: "ontime", header: "On time", align: "right", render: (d) => <span className="tabular">{formatPercent(d.onTimeRate)}</span> },
              { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (d) => <span className="tabular">{formatKm(d.distanceKm)}</span> },
              { key: "score", header: "Score", align: "right", render: (d) => (d.score == null ? <span className="text-xs text-ink-3">Not rated</span> : <span className="tabular font-semibold">{formatNumber(d.score, true)}</span>) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
