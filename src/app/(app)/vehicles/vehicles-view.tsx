"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { FUEL_TYPES, FUEL_TYPE_LABELS, VEHICLE_STATUSES, VEHICLE_TYPES, VEHICLE_TYPE_LABELS, humanize, type FuelType, type VehicleType } from "@/lib/constants";
import { daysUntil, formatDate, formatNumber } from "@/lib/format";
import { DataTable, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { Badge, StatusBadge } from "@/components/app/status-badge";
import { VehicleFormDialog, type VehicleRecord } from "@/components/forms/vehicle-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

interface VehicleRow extends VehicleRecord {
  code: string;
  assignedDriver: { id: string; code: string; fullName: string } | null;
}

/** Highlights documents that have expired or expire within 30 days. */
export function ExpiryCell({ date }: { date: string | Date }) {
  const days = daysUntil(date);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {formatDate(date)}
      {days != null && days < 0 && <Badge tone="danger">Expired</Badge>}
      {days != null && days >= 0 && days <= 30 && <Badge tone="warning">{days === 0 ? "Today" : `${days}d left`}</Badge>}
    </span>
  );
}

export function VehiclesView() {
  const can = useCan();
  const router = useRouter();
  const list = useListState({ filters: { type: "", status: "", fuelType: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<VehicleRow>>(`/api/vehicles${list.query}`);
  const [form, setForm] = useState<{ open: boolean; vehicle: VehicleRow | null }>({ open: false, vehicle: null });
  const [removing, setRemoving] = useState<VehicleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = can("vehicles:write");

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/vehicles/${removing.id}`);
      toast.success(`${removing.registrationNumber} removed from the fleet`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<VehicleRow>[] = [
    {
      key: "vehicle", header: "Vehicle", sortKey: "registrationNumber",
      render: (v) => (
        <div className="min-w-0">
          <Link href={`/vehicles/${v.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-primary hover:underline">
            {v.registrationNumber}
          </Link>
          <p className="truncate text-xs text-ink-3">{v.name} · {v.code}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", sortKey: "type", render: (v) => VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type },
    { key: "model", header: "Make / model", hideBelow: "lg", render: (v) => <span className="text-ink-2">{v.manufacturer} {v.model} ({v.year})</span> },
    { key: "fuel", header: "Fuel", hideBelow: "xl", render: (v) => FUEL_TYPE_LABELS[v.fuelType as FuelType] ?? v.fuelType },
    {
      key: "driver", header: "Assigned driver", hideBelow: "md",
      render: (v) => (v.assignedDriver ? v.assignedDriver.fullName : <span className="text-ink-3">Unassigned</span>),
    },
    { key: "status", header: "Status", sortKey: "status", render: (v) => <StatusBadge status={v.status} /> },
    { key: "odometer", header: "Odometer", sortKey: "odometer", align: "right", hideBelow: "sm", render: (v) => <span className="tabular">{formatNumber(v.odometer)} km</span> },
    { key: "insurance", header: "Insurance expiry", sortKey: "insuranceExpiry", hideBelow: "lg", render: (v) => <ExpiryCell date={v.insuranceExpiry} /> },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (v) => (
        <RowActions
          label={`Actions for ${v.registrationNumber}`}
          actions={[
            { label: "View details", icon: Eye, onSelect: () => router.push(`/vehicles/${v.id}`) },
            { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, vehicle: v }), hidden: !canWrite },
            { label: "Delete", icon: Trash2, tone: "danger", separated: true, onSelect: () => setRemoving(v), hidden: !canWrite },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Register, assign and monitor every vehicle in the fleet."
        actions={
          canWrite && (
            <Button onClick={() => setForm({ open: true, vehicle: null })}>
              <Plus />
              Add vehicle
            </Button>
          )
        }
      />
      <Card>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search registration, name, driver…" />
          <FilterSelect label="Types" value={list.filters.type} onChange={(v) => list.setFilter("type", v)} options={VEHICLE_TYPES.map((t) => ({ value: t, label: VEHICLE_TYPE_LABELS[t] }))} />
          <FilterSelect label="Statuses" value={list.filters.status} onChange={(v) => list.setFilter("status", v)} options={VEHICLE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="Fuel types" value={list.filters.fuelType} onChange={(v) => list.setFilter("fuelType", v)} options={FUEL_TYPES.map((t) => ({ value: t, label: FUEL_TYPE_LABELS[t] }))} />
        </Toolbar>
        <DataTable
          caption="Vehicles"
          columns={columns}
          rows={data?.items}
          rowKey={(v) => v.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          onRowClick={(v) => router.push(`/vehicles/${v.id}`)}
          empty={{
            title: list.activeFilterCount ? "No vehicles match your filters" : "No vehicles yet",
            description: list.activeFilterCount ? "Try a different search or clear the filters." : "Add your first vehicle to start managing the fleet.",
          }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="vehicles" />}
      </Card>

      <VehicleFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} vehicle={form.vehicle} onSaved={reload} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.registrationNumber ?? "vehicle"}?`}
        description="The vehicle will be removed from the active fleet and unassigned from its driver. Its delivery, fuel and maintenance history is kept for reporting."
        confirmLabel="Remove vehicle"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
