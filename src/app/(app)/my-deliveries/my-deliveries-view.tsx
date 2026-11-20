"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, CheckCircle2, ClipboardList, Clock, MapPin, MessageSquareWarning, Navigation, Package, Phone, RefreshCcw, StickyNote } from "lucide-react";
import { useQuery, type Paged } from "@/lib/client";
import { type DeliveryStatus } from "@/lib/constants";
import { manualTransitions } from "@/lib/domain/delivery-status";
import { formatDateTime, formatDuration, formatKm } from "@/lib/format";
import { DataTable, Pagination } from "@/components/app/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from "@/components/app/page";
import { useSocketEvent, useUser } from "@/components/app/providers";
import { StatusBadge } from "@/components/app/status-badge";
import { IssueDialog, StatusDialog } from "@/components/forms/delivery-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import type { DeliveryRow } from "../deliveries/deliveries-view";

interface Row extends DeliveryRow {
  estimatedMinutes: number;
}

export function MyDeliveriesView() {
  const user = useUser();
  const active = useQuery<Paged<Row>>("/api/deliveries?scope=active&pageSize=50&sort=scheduledAt&dir=asc");
  const [historyPage, setHistoryPage] = useState(1);
  const history = useQuery<Paged<Row>>(`/api/deliveries?scope=closed&pageSize=8&page=${historyPage}`);
  const [statusFor, setStatusFor] = useState<Row | null>(null);
  const [issueFor, setIssueFor] = useState<Row | null>(null);

  const refresh = () => {
    active.reload();
    history.reload();
  };
  useSocketEvent("delivery:updated", refresh);

  const next = (d: Row) => manualTransitions(d.status as DeliveryStatus, { pickedUp: !!d.pickedUpAt }, user.role);
  const header = <PageHeader title="My Deliveries" description={`Hello ${user.name.split(" ")[0]}. These are the deliveries assigned to you.`} />;

  if (!user.driverId) {
    return <>{header}<Card><EmptyState icon={ClipboardList} title="No driver profile linked" description="Your login is not linked to a driver profile yet. Ask your fleet manager to link it." /></Card></>;
  }
  if (active.error) return <>{header}<Card><ErrorState message={active.error} onRetry={active.reload} /></Card></>;
  if (active.loading || !active.data) return <>{header}<LoadingState /></>;

  const items = active.data.items;
  const delivered = history.data?.items.filter((d) => d.status === "DELIVERED").length ?? 0;

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active deliveries" value={items.length} icon={Package} />
        <StatCard label="In transit" value={items.filter((d) => d.status === "IN_TRANSIT").length} icon={Navigation} tone="violet" />
        <StatCard label="Delayed" value={items.filter((d) => d.status === "DELAYED").length} icon={Clock} tone={items.some((d) => d.status === "DELAYED") ? "danger" : "neutral"} />
        <StatCard label="Closed deliveries" value={history.data?.total ?? "—"} hint={history.data ? `${delivered} delivered on this page` : undefined} icon={CheckCircle2} tone="success" />
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-ink">Assigned to me</h2>
      {items.length === 0 ? (
        <Card><EmptyState icon={ClipboardList} title="No active deliveries" description="New assignments will appear here and in your notifications." /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((d) => {
            const options = next(d);
            return (
              <Card key={d.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/deliveries/${d.id}`} className="text-sm font-semibold text-primary hover:underline">{d.code}</Link>
                    <StatusBadge status={d.status} />
                    <StatusBadge status={d.priority} />
                  </div>
                  <span className="text-xs text-ink-3">{d.vehicle?.registrationNumber}</span>
                </div>
                <div className="space-y-3 px-4 py-3">
                  <div className="flex gap-2.5">
                    <div className="flex flex-col items-center pt-0.5">
                      <MapPin className="size-4 text-violet" aria-hidden />
                      <span className="my-0.5 w-px flex-1 bg-line" />
                      <ArrowDown className="size-4 text-success" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div><p className="text-xs text-ink-3">Pickup</p><p className="text-[13px] font-medium text-ink">{d.pickupAddress}</p></div>
                      <div><p className="text-xs text-ink-3">Deliver to</p><p className="text-[13px] font-medium text-ink">{d.destinationAddress}</p></div>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                    <div><dt className="text-xs text-ink-3">Customer</dt><dd className="font-medium text-ink">{d.customerName}</dd></div>
                    <div><dt className="text-xs text-ink-3">Contact</dt><dd><a href={`tel:${d.customerPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="size-3.5" aria-hidden />{d.customerPhone}</a></dd></div>
                    <div><dt className="text-xs text-ink-3">Scheduled</dt><dd className="font-medium text-ink">{formatDateTime(d.scheduledAt)}</dd></div>
                    <div><dt className="text-xs text-ink-3">Deliver by</dt><dd className={`font-medium ${new Date() > new Date(d.expectedAt) ? "text-danger" : "text-ink"}`}>{formatDateTime(d.expectedAt)}</dd></div>
                    <div><dt className="text-xs text-ink-3">Distance (approx.)</dt><dd className="font-medium text-ink">{formatKm(d.distanceKm)}</dd></div>
                    <div><dt className="text-xs text-ink-3">Est. travel time</dt><dd className="font-medium text-ink">{formatDuration(d.estimatedMinutes)}</dd></div>
                  </dl>
                  {d.notes && (
                    <p className="flex gap-2 rounded-md bg-warning-soft/60 px-3 py-2 text-[13px] text-ink">
                      <StickyNote className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      <span><span className="font-medium">Instructions: </span>{d.notes}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                  {options.length > 0 && <Button size="sm" onClick={() => setStatusFor(d)}><RefreshCcw />Update status</Button>}
                  <Button size="sm" variant="secondary" onClick={() => setIssueFor(d)}><MessageSquareWarning />Report issue</Button>
                  <Button asChild size="sm" variant="ghost"><Link href={`/deliveries/${d.id}`}>Route &amp; details</Link></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-5">
        <CardHeader title="Delivery history" description="Your closed deliveries" />
        <DataTable
          rows={history.data?.items}
          rowKey={(d) => d.id}
          loading={history.loading}
          refreshing={history.refreshing}
          error={history.error}
          onRetry={history.reload}
          empty={{ title: "No closed deliveries yet" }}
          columns={[
            { key: "code", header: "Delivery", render: (d) => <Link href={`/deliveries/${d.id}`} className="font-medium text-primary hover:underline">{d.code}</Link> },
            { key: "customer", header: "Customer", hideBelow: "sm", render: (d) => d.customerName },
            { key: "dest", header: "Destination", hideBelow: "md", render: (d) => <span className="text-ink-2">{d.destinationAddress}</span> },
            { key: "date", header: "Scheduled", className: "whitespace-nowrap", render: (d) => formatDateTime(d.scheduledAt) },
            { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (d) => <span className="tabular">{formatKm(d.distanceKm)}</span> },
            { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
          ]}
        />
        {history.data && <Pagination page={history.data.page} pageCount={history.data.pageCount} total={history.data.total} pageSize={history.data.pageSize} onPage={setHistoryPage} noun="deliveries" />}
      </Card>

      <StatusDialog
        open={!!statusFor}
        onOpenChange={(open) => !open && setStatusFor(null)}
        delivery={statusFor ? { id: statusFor.id, code: statusFor.code, status: statusFor.status, nextStatuses: next(statusFor) } : null}
        onSaved={refresh}
      />
      <IssueDialog open={!!issueFor} onOpenChange={(open) => !open && setIssueFor(null)} delivery={issueFor} onSaved={refresh} />
    </>
  );
}
