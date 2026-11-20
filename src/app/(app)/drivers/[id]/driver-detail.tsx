"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Gauge, Package, Pencil, Route, Trophy, UserX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useQuery } from "@/lib/client";
import { formatDate, formatDateTime, formatDuration, formatKm, formatPercent } from "@/lib/format";
import type { getDriver } from "@/server/services/drivers";
import { DataTable } from "@/components/app/data-table";
import { DetailList, ErrorState, LoadingState, PageHeader, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { StatusBadge } from "@/components/app/status-badge";
import { DriverFormDialog } from "@/components/forms/driver-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpiryCell } from "../../vehicles/vehicles-view";

type Driver = Awaited<ReturnType<typeof getDriver>>;

export function DriverDetail({ id }: { id: string }) {
  const can = useCan();
  const router = useRouter();
  const { data: d, loading, error, reload } = useQuery<Driver>(`/api/drivers/${id}`);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = { href: "/drivers", label: "Drivers" };

  if (error) return <><PageHeader title="Driver" back={back} /><Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !d) return <><PageHeader title="Driver" back={back} /><LoadingState /></>;

  const s = d.stats;
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/drivers/${id}`);
      toast.success(`${d.fullName} deactivated`);
      router.push("/drivers");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setRemoving(false);
    }
  };

  return (
    <>
      <PageHeader
        back={back}
        title={<span className="flex flex-wrap items-center gap-2.5">{d.fullName}<StatusBadge status={d.status} /></span>}
        description={`${d.code} · joined ${formatDate(d.joiningDate)}`}
        actions={
          <>
            {can("performance:view") && <Button asChild variant="secondary"><Link href={`/performance/${d.id}`}><Trophy />Performance</Link></Button>}
            {can("drivers:write") && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}><Pencil />Edit</Button>
                <Button variant="danger-ghost" onClick={() => setRemoving(true)}><UserX />Deactivate</Button>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Performance score" value={s.score != null ? s.score.toFixed(1) : "Not rated"} hint={s.score != null ? "out of 100" : "Needs 3 closed deliveries"} icon={Gauge} />
        <StatCard label="Total deliveries" value={s.total} hint={`${s.active} active`} icon={Package} tone="neutral" />
        <StatCard label="Completed" value={s.delivered} hint={`${formatPercent(s.successRate)} success rate`} icon={CheckCircle2} tone="success" />
        <StatCard label="Failed" value={s.failed} hint={`${s.cancelled} cancelled`} icon={XCircle} tone={s.failed ? "danger" : "neutral"} />
        <StatCard label="On-time rate" value={formatPercent(s.onTimeRate)} hint={`${s.onTime} on time · ${s.late} late`} icon={Clock} tone="warning" />
        <StatCard label="Distance covered" value={formatKm(s.distanceKm)} hint={s.avgDurationMin ? `Avg ${formatDuration(s.avgDurationMin)} per delivery` : "Delivered jobs"} icon={Route} tone="violet" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Driver information" />
          <CardBody>
            <DetailList
              columns={3}
              items={[
                { label: "Driver ID", value: d.code },
                { label: "Full name", value: d.fullName },
                { label: "Email", value: d.email },
                { label: "Phone number", value: d.phone },
                { label: "Driving licence number", value: d.licenseNumber },
                { label: "Licence expiry", value: <ExpiryCell date={d.licenseExpiry} /> },
                { label: "Joining date", value: formatDate(d.joiningDate) },
                { label: "Login account", value: d.hasLogin ? "Enabled" : "Not created" },
                { label: "Address", value: d.address },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Assigned vehicle" />
          <CardBody>
            {d.vehicle ? (
              <DetailList
                columns={1}
                items={[
                  { label: "Vehicle", value: <Link href={`/vehicles/${d.vehicle.id}`} className="text-primary hover:underline">{d.vehicle.registrationNumber}</Link> },
                  { label: "Name", value: d.vehicle.name },
                  { label: "Vehicle status", value: <StatusBadge status={d.vehicle.status} /> },
                ]}
              />
            ) : (
              <p className="text-[13px] text-ink-3">No vehicle assigned. Use Edit to assign one.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <Tabs defaultValue="deliveries">
          <TabsList className="px-3 pt-1">
            <TabsTrigger value="deliveries">Delivery history ({s.total})</TabsTrigger>
            <TabsTrigger value="history">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="deliveries" className="pt-0">
            <DataTable
              rows={d.deliveries}
              rowKey={(x) => x.id}
              onRowClick={(x) => router.push(`/deliveries/${x.id}`)}
              empty={{ title: "No deliveries yet", description: "Deliveries assigned to this driver will appear here." }}
              columns={[
                { key: "code", header: "Delivery", render: (x) => <span className="font-medium text-primary">{x.code}</span> },
                { key: "customer", header: "Customer", render: (x) => x.customerName },
                { key: "dest", header: "Destination", hideBelow: "md", render: (x) => <span className="text-ink-2">{x.destinationAddress}</span> },
                { key: "vehicle", header: "Vehicle", hideBelow: "lg", render: (x) => x.vehicle?.registrationNumber ?? "—" },
                { key: "date", header: "Scheduled", hideBelow: "sm", render: (x) => formatDate(x.scheduledAt) },
                { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (x) => <span className="tabular">{formatKm(x.distanceKm)}</span> },
                {
                  key: "ontime", header: "Timing", hideBelow: "lg",
                  render: (x) => (x.status === "DELIVERED" && x.deliveredAt ? <StatusBadge status={new Date(x.deliveredAt) <= new Date(x.expectedAt) ? "DELIVERED" : "DELAYED"} label={new Date(x.deliveredAt) <= new Date(x.expectedAt) ? "On time" : "Late"} /> : "—"),
                },
                { key: "status", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
              ]}
            />
            {s.total > d.deliveries.length && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">Showing the latest {d.deliveries.length} of {s.total} deliveries.</p>}
          </TabsContent>
          <TabsContent value="history" className="pt-0">
            <DataTable
              rows={d.history}
              rowKey={(h) => h.id}
              empty={{ title: "No activity recorded" }}
              columns={[
                { key: "when", header: "When", className: "whitespace-nowrap", render: (h) => formatDateTime(h.createdAt) },
                { key: "desc", header: "Activity", render: (h) => h.description },
                { key: "who", header: "By", hideBelow: "sm", render: (h) => h.user?.name ?? "System" },
              ]}
            />
          </TabsContent>
        </Tabs>
      </Card>

      <DriverFormDialog open={editing} onOpenChange={setEditing} driver={d} onSaved={reload} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Deactivate ${d.fullName}?`}
        description="The driver will be removed from the active roster, released from their vehicle and their login disabled. Delivery history is kept for reporting."
        confirmLabel="Deactivate driver"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
