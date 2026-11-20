"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Plus, UserX } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { DRIVER_STATUSES, humanize } from "@/lib/constants";
import type { PerformanceStats } from "@/lib/domain/performance";
import { formatKm } from "@/lib/format";
import { DataTable, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { StatusBadge } from "@/components/app/status-badge";
import { DriverFormDialog, type DriverRecord } from "@/components/forms/driver-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ExpiryCell } from "../vehicles/vehicles-view";

interface DriverRow extends DriverRecord {
  stats: PerformanceStats;
}

export function ScoreCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-ink-3">Not rated</span>;
  return <span className="tabular font-semibold text-ink">{score.toFixed(1)}</span>;
}

export function DriversView() {
  const can = useCan();
  const router = useRouter();
  const list = useListState({ filters: { status: "", assigned: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<DriverRow>>(`/api/drivers${list.query}`);
  const [form, setForm] = useState<{ open: boolean; driver: DriverRow | null }>({ open: false, driver: null });
  const [removing, setRemoving] = useState<DriverRow | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = can("drivers:write");

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/drivers/${removing.id}`);
      toast.success(`${removing.fullName} deactivated`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<DriverRow>[] = [
    {
      key: "driver", header: "Driver", sortKey: "fullName",
      render: (d) => (
        <div className="min-w-0">
          <Link href={`/drivers/${d.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-primary hover:underline">
            {d.fullName}
          </Link>
          <p className="truncate text-xs text-ink-3">{d.code} · {d.phone}</p>
        </div>
      ),
    },
    { key: "vehicle", header: "Assigned vehicle", hideBelow: "md", render: (d) => (d.vehicle ? d.vehicle.registrationNumber : <span className="text-ink-3">None</span>) },
    { key: "status", header: "Status", sortKey: "status", render: (d) => <StatusBadge status={d.status} /> },
    {
      key: "deliveries", header: "Deliveries", align: "right", hideBelow: "sm",
      render: (d) => (
        <span className="tabular" title={`${d.stats.delivered} delivered, ${d.stats.failed} failed, ${d.stats.total} total`}>
          {d.stats.delivered}<span className="text-ink-3"> / {d.stats.total}</span>
        </span>
      ),
    },
    { key: "failed", header: "Failed", align: "right", hideBelow: "xl", render: (d) => <span className="tabular">{d.stats.failed}</span> },
    { key: "distance", header: "Distance", align: "right", hideBelow: "lg", render: (d) => <span className="tabular">{formatKm(d.stats.distanceKm)}</span> },
    { key: "score", header: "Score", align: "right", render: (d) => <ScoreCell score={d.stats.score} /> },
    { key: "license", header: "Licence expiry", sortKey: "licenseExpiry", hideBelow: "lg", render: (d) => <ExpiryCell date={d.licenseExpiry} /> },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (d) => (
        <RowActions
          label={`Actions for ${d.fullName}`}
          actions={[
            { label: "View profile", icon: Eye, onSelect: () => router.push(`/drivers/${d.id}`) },
            { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, driver: d }), hidden: !canWrite },
            { label: "Deactivate", icon: UserX, tone: "danger", separated: true, onSelect: () => setRemoving(d), hidden: !canWrite },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Driver profiles, vehicle assignments, licences and delivery record."
        actions={
          canWrite && (
            <Button onClick={() => setForm({ open: true, driver: null })}>
              <Plus />
              Add driver
            </Button>
          )
        }
      />
      <Card>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, phone, licence…" />
          <FilterSelect label="Statuses" value={list.filters.status} onChange={(v) => list.setFilter("status", v)} options={DRIVER_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect
            label="Assignment"
            allLabel="Any assignment"
            value={list.filters.assigned}
            onChange={(v) => list.setFilter("assigned", v)}
            options={[{ value: "yes", label: "Has a vehicle" }, { value: "no", label: "No vehicle" }]}
          />
        </Toolbar>
        <DataTable
          caption="Drivers"
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
          onRowClick={(d) => router.push(`/drivers/${d.id}`)}
          empty={{
            title: list.activeFilterCount ? "No drivers match your filters" : "No drivers yet",
            description: list.activeFilterCount ? "Try a different search or clear the filters." : "Add your first driver to start assigning deliveries.",
          }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="drivers" />}
      </Card>

      <DriverFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} driver={form.driver} onSaved={reload} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Deactivate ${removing?.fullName ?? "driver"}?`}
        description="The driver will be removed from the active roster, released from their vehicle and their login disabled. Delivery history is kept for reporting."
        confirmLabel="Deactivate driver"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
