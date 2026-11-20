"use client";

import Link from "next/link";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, Fuel, Gauge, Navigation, Package, RefreshCw, Route, ShieldAlert, Truck, UserCheck, Users, Wrench,
} from "lucide-react";
import { useQuery } from "@/lib/client";
import { formatDate, formatINR, formatKm, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import type { getDashboard } from "@/server/services/analytics";
import { BarSeriesChart, ChartCard, compactINR, DonutChart, LineSeriesChart, Meter, OUTCOME, SERIES } from "@/components/app/charts";
import { RiskCard } from "@/components/app/intelligence";
import { DashboardSkeleton, EmptyState, ErrorState, PageHeader, StatCard } from "@/components/app/page";
import { useSocketEvent, useUser } from "@/components/app/providers";
import { useRange } from "@/components/app/range-picker";
import { Badge, STATUS_COLORS, StatusBadge, toneFor } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

const KIND_LABEL = { INSURANCE: "Insurance", REGISTRATION: "Registration", LICENSE: "Driving licence" } as const;

export function DashboardView() {
  const user = useUser();
  const range = useRange("30d");
  const { data, loading, refreshing, error, reload } = useQuery<Dashboard>(`/api/dashboard?${range.query}`);

  // Keep the control room current as deliveries move.
  useSocketEvent("delivery:updated", reload);

  const header = (
    <PageHeader
      title="Dashboard"
      description={`Welcome back, ${user.name.split(" ")[0]}. Here is what is happening across the fleet.`}
      actions={
        <>
          {range.picker}
          <Button variant="secondary" size="icon" onClick={reload} aria-label="Refresh dashboard" title="Refresh">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </>
      }
    />
  );

  if (error) return <>{header}<Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !data) return <>{header}<DashboardSkeleton cards={12} /></>;

  const { kpis, charts } = data;
  const perfHasData = charts.deliveryPerformance.some((d) => d.onTime + d.late + d.failed > 0);

  return (
    <>
      {header}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total vehicles" value={kpis.totalVehicles} hint={`${kpis.inactiveVehicles} inactive`} icon={Truck} href="/vehicles" />
        <StatCard label="Active vehicles" value={kpis.activeVehicles} hint={`${formatNumber(kpis.fleetUtilization, true)}% utilisation`} icon={Navigation} tone="primary" href="/tracking" />
        <StatCard label="Available vehicles" value={kpis.availableVehicles} hint="Ready to dispatch" icon={CheckCircle2} tone="success" />
        <StatCard label="Under maintenance" value={kpis.maintenanceVehicles} hint={data.maintenanceAlerts ? `${data.maintenanceAlertCount} service alerts` : undefined} icon={Wrench} tone="warning" />
        <StatCard label="Total drivers" value={kpis.totalDrivers} hint={`${kpis.onDeliveryDrivers} on delivery`} icon={Users} tone="violet" href="/drivers" />
        <StatCard label="Available drivers" value={kpis.availableDrivers} hint="Ready for assignment" icon={UserCheck} tone="success" />
        <StatCard label="Active deliveries" value={kpis.activeDeliveries} hint={`${kpis.pendingDeliveries} pending dispatch`} icon={Package} href="/deliveries" />
        <StatCard
          label="Completed deliveries"
          value={kpis.completedDeliveries}
          hint={kpis.onTimeRate == null ? range.phrase.charAt(0).toUpperCase() + range.phrase.slice(1) : `${kpis.onTimeRate}% on time`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard label="Delayed deliveries" value={kpis.delayedDeliveries} hint={`${kpis.lateDeliveries} delivered late in period`} icon={Clock} tone={kpis.delayedDeliveries ? "danger" : "neutral"} />
        <StatCard label="Distance covered" value={formatKm(kpis.totalDistanceKm)} hint="Delivered jobs in period" icon={Route} tone="neutral" />
        {kpis.fuelCostPaise != null && (
          <StatCard label="Fuel expenditure" value={formatINR(kpis.fuelCostPaise)} hint={`${formatNumber(kpis.fuelLitres, true)} L in period`} icon={Fuel} tone="warning" href="/fuel" />
        )}
        {kpis.maintenanceCostPaise != null && (
          <StatCard label="Maintenance spend" value={formatINR(kpis.maintenanceCostPaise)} hint="Completed jobs in period" icon={Wrench} tone="neutral" href="/maintenance" />
        )}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Delivery performance"
          description={`Closed deliveries per ${charts.performanceUnit}, by outcome`}
          empty={!perfHasData}
        >
          <BarSeriesChart
            stacked
            data={charts.deliveryPerformance}
            xKey="label"
            series={[
              { key: "onTime", label: "On time", color: OUTCOME.good },
              { key: "late", label: "Late", color: OUTCOME.warning },
              { key: "failed", label: "Failed", color: OUTCOME.critical },
            ]}
          />
        </ChartCard>
        <ChartCard title="Vehicle status" description="Current fleet distribution">
          <DonutChart centerLabel="vehicles" data={charts.vehicleStatus.map((s) => ({ label: s.label, value: s.count, color: STATUS_COLORS[s.status] }))} />
        </ChartCard>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Monthly delivery trends" description="Deliveries scheduled per month, last 6 months">
          <LineSeriesChart
            data={charts.monthlyTrends}
            xKey="label"
            series={[
              { key: "total", label: "Scheduled", color: SERIES[0] },
              { key: "delivered", label: "Delivered", color: SERIES[2] },
            ]}
          />
        </ChartCard>
        {charts.fuelByMonth && (
          <ChartCard title="Fuel expenditure" description="Monthly fuel spend (₹), last 6 months">
            <BarSeriesChart data={charts.fuelByMonth} xKey="label" series={[{ key: "cost", label: "Fuel spend", color: SERIES[0] }]} format={(v) => formatINR(v * 100)} tickFormat={compactINR} />
          </ChartCard>
        )}
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Fleet utilisation" description="Share of operational vehicles out on delivery, by type" />
          <ul className="space-y-3 p-4">
            {charts.fleetUtilization.map((u) => (
              <li key={u.type}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="font-medium text-ink">{u.label}</span>
                  <span className="tabular text-xs text-ink-3">
                    {u.onDelivery} of {u.total} on delivery · <span className="font-medium text-ink">{u.utilization}%</span>
                  </span>
                </div>
                <Meter value={u.utilization} label={`${u.label} utilisation`} />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent deliveries" description="Most recently updated" action={<Link href="/deliveries" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-canvas/70 text-left text-xs text-ink-3">
                  <th className="px-3 py-2 font-medium">Delivery</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Driver</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.recentDeliveries.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/deliveries/${d.id}`} className="font-medium text-primary hover:underline">{d.code}</Link>
                    </td>
                    <td className="max-w-56 px-3 py-2">
                      <p className="truncate text-ink">{d.customerName}</p>
                      <p className="truncate text-xs text-ink-3">{d.destinationAddress}</p>
                    </td>
                    <td className="hidden px-3 py-2 text-ink-2 md:table-cell">{d.driver?.fullName ?? "Unassigned"}</td>
                    <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-right text-xs text-ink-3 sm:table-cell">{timeAgo(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
        <RiskCard />
        <Card>
          <CardHeader title="Driver performance" description={`Top rated ${range.phrase}`} action={<Link href="/performance" className="text-xs font-medium text-primary hover:underline">Leaderboard</Link>} />
          {charts.topDrivers.length === 0 ? (
            <EmptyState icon={Gauge} title="No rated drivers yet" description="Drivers are ranked once they have closed at least 3 deliveries in the period." className="py-8" />
          ) : (
            <ol className="divide-y divide-line">
              {charts.topDrivers.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-neutral-soft text-xs font-semibold text-ink-2">{d.rank}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{d.name}</p>
                    <p className="text-xs text-ink-3">{d.delivered} delivered · {formatPercent(d.onTimeRate)} on time</p>
                  </div>
                  <div className="w-20 text-right">
                    <p className="tabular text-sm font-semibold text-ink">{d.score?.toFixed(1)}</p>
                    <Meter value={d.score} label={`${d.name} score`} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {data.maintenanceAlerts && (
          <Card>
            <CardHeader title="Maintenance alerts" description="Due soon and overdue services" action={<Link href="/maintenance" className="text-xs font-medium text-primary hover:underline">Manage</Link>} />
            {data.maintenanceAlerts.length === 0 ? (
              <EmptyState icon={Wrench} title="No maintenance due" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {data.maintenanceAlerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 px-4 py-2.5">
                    <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.state === "OVERDUE" ? "text-danger" : "text-warning"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{a.registrationNumber} · {a.typeLabel}</p>
                      <p className="text-xs text-ink-3">{a.reason}</p>
                    </div>
                    <StatusBadge status={a.state} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {data.complianceAlerts && (
          <Card>
            <CardHeader title="Upcoming reminders" description="Insurance, registration and licence expiry" />
            {data.complianceAlerts.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing expiring soon" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {data.complianceAlerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 px-4 py-2.5">
                    <ShieldAlert className={`mt-0.5 size-4 shrink-0 ${a.state === "OVERDUE" ? "text-danger" : "text-warning"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{KIND_LABEL[a.kind]} · {a.subject}</p>
                      <p className="text-xs text-ink-3">
                        {a.state === "OVERDUE" ? `Expired ${formatDate(a.expiry)}` : a.days === 0 ? "Expires today" : `Expires in ${a.days} day${a.days === 1 ? "" : "s"} (${formatDate(a.expiry)})`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Notifications" description="Your latest operational alerts" action={<Link href="/notifications" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          {data.notifications.length === 0 ? (
            <EmptyState title="No notifications" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {data.notifications.map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-ink">{n.title}</p>
                    <Badge tone={toneFor(n.severity)}>{n.category.charAt(0) + n.category.slice(1).toLowerCase()}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{timeAgo(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.recentActivity && (
          <Card>
            <CardHeader title="Recent activity" description="Latest actions across the system" action={<Link href="/activity" className="text-xs font-medium text-primary hover:underline">Audit log</Link>} />
            <ul className="divide-y divide-line">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <p className="line-clamp-2 text-[13px] text-ink">{a.description}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{a.user?.name ?? "System"} · {timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
