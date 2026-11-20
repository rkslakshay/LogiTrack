"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, Pencil, Plus, RefreshCcw, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { DELIVERY_STATUSES, PRIORITIES, humanize, type DeliveryStatus } from "@/lib/constants";
import { manualTransitions } from "@/lib/domain/delivery-status";
import { formatDateTime, formatKm } from "@/lib/format";
import { DataTable, DateRangeFilter, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page";
import { useCan, useSocketEvent, useUser } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { RiskBadge, StatusBadge } from "@/components/app/status-badge";
import { AssignDialog, StatusDialog } from "@/components/forms/delivery-actions";
import { DeliveryFormDialog, type DeliveryRecord } from "@/components/forms/delivery-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

export interface DeliveryRow extends DeliveryRecord {
  status: string;
  distanceKm: number;
  driverId: string | null;
  vehicleId: string | null;
  deliveredAt: string | null;
  /** Rule-based delay risk; null once the delivery is closed. */
  risk: { level: string; reasons: string[]; slackMinutes: number } | null;
  driver: { id: string; fullName: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
}

const SCOPES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "PENDING", label: "Pending" },
  { value: "closed", label: "Closed" },
];

export function DeliveriesView() {
  const can = useCan();
  const user = useUser();
  const router = useRouter();
  const list = useListState({ filters: { status: "", priority: "", from: "", to: "", scope: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<DeliveryRow>>(`/api/deliveries${list.query}`);
  const [form, setForm] = useState<{ open: boolean; delivery: DeliveryRow | null }>({ open: false, delivery: null });
  const [assigning, setAssigning] = useState<DeliveryRow | null>(null);
  const [statusFor, setStatusFor] = useState<DeliveryRow | null>(null);
  const [removing, setRemoving] = useState<DeliveryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = can("deliveries:write");
  const canStatus = can("deliveries:status");

  useSocketEvent("delivery:updated", reload);

  const nextStatuses = (d: DeliveryRow) => manualTransitions(d.status as DeliveryStatus, { pickedUp: !!d.pickedUpAt }, user.role);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/deliveries/${removing.id}`);
      toast.success(`${removing.code} deleted`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setScope = (value: string) => {
    // "Pending" is a plain status filter; the others are groups handled by the API.
    list.setFilter("scope", value === "PENDING" ? "" : value);
    list.setFilter("status", value === "PENDING" ? "PENDING" : "");
  };
  const activeScope = list.filters.scope || (list.filters.status === "PENDING" ? "PENDING" : list.filters.status ? "__custom" : "");

  const columns: Column<DeliveryRow>[] = [
    {
      key: "code", header: "Delivery", sortKey: "code",
      render: (d) => (
        <Link href={`/deliveries/${d.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-primary hover:underline">
          {d.code}
        </Link>
      ),
    },
    {
      key: "customer", header: "Customer", sortKey: "customerName",
      render: (d) => (
        <div className="min-w-0 max-w-48">
          <p className="truncate">{d.customerName}</p>
          <p className="truncate text-xs text-ink-3">{d.customerPhone}</p>
        </div>
      ),
    },
    {
      key: "route", header: "Route", hideBelow: "lg",
      render: (d) => (
        <div className="max-w-72 text-xs text-ink-2">
          <p className="truncate">{d.pickupAddress}</p>
          <p className="flex items-center gap-1 truncate"><ArrowRight className="size-3 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{d.destinationAddress}</span></p>
        </div>
      ),
    },
    {
      key: "assignment", header: "Driver / vehicle", hideBelow: "md",
      render: (d) =>
        d.driver ? (
          <div className="min-w-0">
            <p className="truncate">{d.driver.fullName}</p>
            <p className="truncate text-xs text-ink-3">{d.vehicle?.registrationNumber}</p>
          </div>
        ) : (
          <span className="text-ink-3">Unassigned</span>
        ),
    },
    { key: "scheduled", header: "Scheduled", sortKey: "scheduledAt", hideBelow: "sm", className: "whitespace-nowrap", render: (d) => formatDateTime(d.scheduledAt) },
    { key: "distance", header: "Distance", sortKey: "distanceKm", align: "right", hideBelow: "2xl", render: (d) => <span className="tabular">{formatKm(d.distanceKm)}</span> },
    { key: "priority", header: "Priority", sortKey: "priority", hideBelow: "md", render: (d) => <StatusBadge status={d.priority} /> },
    { key: "status", header: "Status", sortKey: "status", render: (d) => <StatusBadge status={d.status} /> },
    { key: "risk", header: "Delay risk", hideBelow: "md", render: (d) => <RiskBadge risk={d.risk} /> },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (d) => {
        const open = d.status !== "DELIVERED" && d.status !== "FAILED" && d.status !== "CANCELLED";
        const assignable = d.status === "PENDING" || d.status === "ASSIGNED";
        return (
          <RowActions
            label={`Actions for ${d.code}`}
            actions={[
              { label: "View details", icon: Eye, onSelect: () => router.push(`/deliveries/${d.id}`) },
              { label: d.status === "ASSIGNED" ? "Reassign" : "Assign driver & vehicle", icon: UserPlus, onSelect: () => setAssigning(d), hidden: !canWrite || !assignable },
              { label: "Update status", icon: RefreshCcw, onSelect: () => setStatusFor(d), hidden: !canStatus || nextStatuses(d).length === 0 },
              { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, delivery: d }), hidden: !canWrite || !open },
              { label: "Delete", icon: Trash2, tone: "danger", separated: true, onSelect: () => setRemoving(d), hidden: !canWrite || (d.status !== "PENDING" && d.status !== "CANCELLED") },
            ]}
          />
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Create consignments, assign drivers and vehicles, and follow each delivery to completion."
        actions={
          canWrite && (
            <Button onClick={() => setForm({ open: true, delivery: null })}>
              <Plus />
              Create delivery
            </Button>
          )
        }
      />
      <Card>
        <div className="flex gap-1 border-b border-line px-3 pt-2" role="tablist" aria-label="Delivery groups">
          {SCOPES.map((s) => (
            <button
              key={s.label}
              type="button"
              role="tab"
              aria-selected={activeScope === s.value}
              onClick={() => setScope(s.value)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium ${activeScope === s.value ? "border-primary text-primary" : "border-transparent text-ink-3 hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search ID, customer, address, driver…" />
          <FilterSelect
            label="Statuses"
            value={list.filters.scope ? "" : list.filters.status}
            onChange={(v) => {
              list.setFilter("scope", "");
              list.setFilter("status", v);
            }}
            options={DELIVERY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
          />
          <FilterSelect label="Priorities" value={list.filters.priority} onChange={(v) => list.setFilter("priority", v)} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          <DateRangeFilter
            from={list.filters.from}
            to={list.filters.to}
            onChange={(from, to) => {
              list.setFilter("from", from);
              list.setFilter("to", to);
            }}
          />
        </Toolbar>
        <DataTable
          caption="Deliveries"
          columns={columns}
          rows={data?.items}
          rowKey={(d) => d.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          onRowClick={(d) => router.push(`/deliveries/${d.id}`)}
          empty={{
            title: list.activeFilterCount ? "No deliveries match your filters" : "No deliveries yet",
            description: list.activeFilterCount ? "Try a different search, status or date range." : "Create a delivery to get started.",
          }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="deliveries" />}
      </Card>

      <DeliveryFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} delivery={form.delivery} onSaved={reload} />
      <AssignDialog
        open={!!assigning}
        onOpenChange={(open) => !open && setAssigning(null)}
        title={`Assign ${assigning?.code ?? "delivery"}`}
        endpoint={`/api/deliveries/${assigning?.id}/assign`}
        current={assigning ? { driverId: assigning.driverId, vehicleId: assigning.vehicleId } : undefined}
        onSaved={reload}
      />
      <StatusDialog
        open={!!statusFor}
        onOpenChange={(open) => !open && setStatusFor(null)}
        delivery={statusFor ? { id: statusFor.id, code: statusFor.code, status: statusFor.status, nextStatuses: nextStatuses(statusFor) } : null}
        onSaved={reload}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing?.code ?? "delivery"}?`}
        description="This permanently removes the delivery and its event history. This cannot be undone."
        confirmLabel="Delete delivery"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
