"use client";

import { useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, CircleSlash, IndianRupee, Pencil, Play, Plus, ShieldAlert, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { MAINTENANCE_STATUSES, MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABELS, humanize, type MaintenanceType } from "@/lib/constants";
import { formatDate, formatINR, formatNumber, paiseToRupees, toDateInput } from "@/lib/format";
import { maintenanceCompleteSchema, maintenanceSchema } from "@/lib/validation";
import type { ComplianceAlert, MaintenanceAlert } from "@/server/services/maintenance";
import { DataTable, DateRangeFilter, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { FormDialog, type FieldConfig } from "@/components/app/form-dialog";
import { ServiceRecommendationsCard } from "@/components/app/intelligence";
import { EmptyState, PageHeader, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

interface MaintenanceRow {
  id: string;
  code: string;
  vehicleId: string;
  type: string;
  description: string;
  serviceDate: string;
  nextServiceDate: string | null;
  nextServiceOdometer: number | null;
  odometer: number | null;
  costPaise: number;
  provider: string;
  status: string;
  vehicle: { id: string; registrationNumber: string; name: string; status: string; odometer: number };
}
interface VehicleOption {
  id: string;
  registrationNumber: string;
  name: string;
  status: string;
  odometer: number;
}
interface Alerts {
  maintenance: MaintenanceAlert[];
  compliance: ComplianceAlert[];
}

const typeLabel = (t: string) => MAINTENANCE_TYPE_LABELS[t as MaintenanceType] ?? t;
const KIND_LABEL = { INSURANCE: "Insurance", REGISTRATION: "Registration", LICENSE: "Driving licence" } as const;

export function MaintenanceView() {
  const can = useCan();
  const canWrite = can("maintenance:write");
  const list = useListState({ filters: { vehicleId: "", status: "", type: "", from: "", to: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<MaintenanceRow> & { completedCostPaise: number; completedCount: number }>(`/api/maintenance${list.query}`);
  const alerts = useQuery<Alerts>("/api/maintenance/alerts");
  const vehicles = useQuery<VehicleOption[]>("/api/vehicles/options");
  const [form, setForm] = useState<{ open: boolean; record: MaintenanceRow | null; preset?: Partial<MaintenanceRow> }>({ open: false, record: null });
  const [completing, setCompleting] = useState<MaintenanceRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "cancel"; record: MaintenanceRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const refresh = () => {
    reload();
    alerts.reload();
    vehicles.reload();
  };

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setConfirm(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runSweep = async () => {
    setSweeping(true);
    try {
      const r = await api.post<{ notificationsCreated: number; deliveriesFlaggedDelayed: number }>("/api/reminders/run");
      toast.success(r.notificationsCreated ? `${r.notificationsCreated} new reminder notification${r.notificationsCreated === 1 ? "" : "s"} sent` : "Reminders are up to date");
      alerts.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSweeping(false);
    }
  };

  const record = form.record;
  const fields: FieldConfig[] = [
    {
      name: "vehicleId", label: "Vehicle", type: "select", required: true, emptyOption: "Select a vehicle…",
      options: (vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.registrationNumber} · ${v.name}` })),
    },
    { name: "type", label: "Maintenance type", type: "select", required: true, emptyOption: "Select a type…", options: MAINTENANCE_TYPES.map((t) => ({ value: t, label: MAINTENANCE_TYPE_LABELS[t] })) },
    { name: "description", label: "Description", type: "textarea", required: true, wide: true, placeholder: "Work to be carried out" },
    { name: "serviceDate", label: "Service date", type: "date", required: true },
    { name: "provider", label: "Service provider", required: true, placeholder: "Tata Motors Authorised Service" },
    {
      name: "status", label: "Status", type: "select", required: true, emptyOption: null,
      hint: "Setting In Progress takes the vehicle out of service",
      options: MAINTENANCE_STATUSES.map((s) => ({ value: s, label: humanize(s) })),
    },
    { name: "cost", label: "Cost (₹)", type: "number", step: "0.01", min: 0, hint: "Estimate for scheduled work, final for completed" },
    { name: "odometer", label: "Odometer at service (km)", type: "number", min: 0 },
    { name: "nextServiceDate", label: "Next service date", type: "date", section: "Follow-up reminder (optional)" },
    { name: "nextServiceOdometer", label: "Next service odometer (km)", type: "number", min: 0 },
  ];

  const columns: Column<MaintenanceRow>[] = [
    { key: "date", header: "Service date", sortKey: "serviceDate", className: "whitespace-nowrap", render: (m) => formatDate(m.serviceDate) },
    { key: "vehicle", header: "Vehicle", render: (m) => <div><p className="whitespace-nowrap font-medium">{m.vehicle.registrationNumber}</p><p className="text-xs text-ink-3">{m.vehicle.name}</p></div> },
    {
      key: "type", header: "Work", sortKey: "type",
      render: (m) => <div className="max-w-72"><p>{typeLabel(m.type)}</p><p className="truncate text-xs text-ink-3">{m.description}</p></div>,
    },
    { key: "provider", header: "Provider", sortKey: "provider", hideBelow: "lg", render: (m) => <span className="text-ink-2">{m.provider}</span> },
    { key: "cost", header: "Cost", sortKey: "costPaise", align: "right", hideBelow: "sm", render: (m) => <span className="tabular">{formatINR(m.costPaise)}</span> },
    {
      key: "next", header: "Next service", sortKey: "nextServiceDate", hideBelow: "xl",
      render: (m) => (m.nextServiceDate || m.nextServiceOdometer ? <span className="text-ink-2">{[m.nextServiceDate && formatDate(m.nextServiceDate), m.nextServiceOdometer && `${formatNumber(m.nextServiceOdometer)} km`].filter(Boolean).join(" · ")}</span> : "—"),
    },
    { key: "status", header: "Status", sortKey: "status", render: (m) => <StatusBadge status={m.status} /> },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (m) => {
        const open = m.status === "SCHEDULED" || m.status === "IN_PROGRESS";
        return (
          <RowActions
            label={`Actions for ${m.code}`}
            actions={[
              { label: "Start work", icon: Play, onSelect: () => act(() => api.post(`/api/maintenance/${m.id}/start`), `${m.code} started: ${m.vehicle.registrationNumber} is now under maintenance`), hidden: !canWrite || m.status !== "SCHEDULED" },
              { label: "Mark completed", icon: CheckCircle2, onSelect: () => setCompleting(m), hidden: !canWrite || !open },
              { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, record: m }), hidden: !canWrite },
              { label: "Cancel job", icon: CircleSlash, separated: true, onSelect: () => setConfirm({ kind: "cancel", record: m }), hidden: !canWrite || !open },
              { label: "Delete", icon: Trash2, tone: "danger", onSelect: () => setConfirm({ kind: "delete", record: m }), hidden: !canWrite || m.status === "COMPLETED" },
            ]}
          />
        );
      },
    },
  ];

  const mAlerts = alerts.data?.maintenance ?? [];
  const overdue = mAlerts.filter((a) => a.state === "OVERDUE").length;
  const inService = (vehicles.data ?? []).filter((v) => v.status === "MAINTENANCE").length;

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Schedule service, track costs and keep the fleet roadworthy."
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={runSweep} loading={sweeping}><BellRing />Check reminders now</Button>
              <Button onClick={() => setForm({ open: true, record: null })}><Plus />Schedule maintenance</Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Overdue" value={overdue} hint="Past the service date or odometer" icon={AlertTriangle} tone={overdue ? "danger" : "neutral"} />
        <StatCard label="Due soon" value={mAlerts.length - overdue} hint="Inside the reminder window" icon={CalendarClock} tone="warning" />
        <StatCard label="Vehicles in service" value={inService} hint="Unavailable for deliveries" icon={Wrench} />
        <StatCard label="Service cost" value={formatINR(data?.completedCostPaise ?? 0)} hint={`${data?.completedCount ?? 0} completed jobs in selection`} icon={IndianRupee} tone="violet" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Scheduled and due" description="Jobs people have booked, and follow-ups set on completed jobs" />
          {mAlerts.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No maintenance due" description="Upcoming and overdue services will appear here." className="py-8" />
          ) : (
            <ul className="scroll-thin max-h-64 divide-y divide-line overflow-y-auto">
              {mAlerts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <AlertTriangle className={`size-4 shrink-0 ${a.state === "OVERDUE" ? "text-danger" : "text-warning"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{a.registrationNumber} · {a.typeLabel}</p>
                    <p className="text-xs text-ink-3">{a.reason}{a.followUp ? ` (follow-up to ${a.code})` : ` (${a.code})`}</p>
                  </div>
                  <StatusBadge status={a.state} />
                  {canWrite && a.followUp && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setForm({ open: true, record: null, preset: { vehicleId: a.vehicleId, type: a.type, description: `Follow-up ${a.typeLabel.toLowerCase()}` } })}
                    >
                      Schedule
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Document expiry" description="Insurance, registration and driving licences" />
          {(alerts.data?.compliance ?? []).length === 0 ? (
            <EmptyState icon={ShieldAlert} title="Nothing expiring soon" className="py-8" />
          ) : (
            <ul className="scroll-thin max-h-64 divide-y divide-line overflow-y-auto">
              {alerts.data!.compliance.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ShieldAlert className={`size-4 shrink-0 ${a.state === "OVERDUE" ? "text-danger" : "text-warning"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{KIND_LABEL[a.kind]} · {a.subject}</p>
                    <p className="text-xs text-ink-3">{a.state === "OVERDUE" ? `Expired on ${formatDate(a.expiry)}` : `Expires ${formatDate(a.expiry)} (${a.days === 0 ? "today" : `in ${a.days} day${a.days === 1 ? "" : "s"}`})`}</p>
                  </div>
                  <StatusBadge status={a.state} label={a.state === "OVERDUE" ? "Expired" : "Expiring"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <ServiceRecommendationsCard
          onSchedule={
            canWrite
              ? (s) => setForm({ open: true, record: null, preset: { vehicleId: s.vehicleId, type: "GENERAL_SERVICE", description: s.description, serviceDate: s.projectedDate ? String(s.projectedDate) : undefined } })
              : undefined
          }
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="Maintenance history" />
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search description, provider, vehicle…" />
          <FilterSelect label="Vehicles" value={list.filters.vehicleId} onChange={(v) => list.setFilter("vehicleId", v)} options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.registrationNumber} · ${v.name}` }))} />
          <FilterSelect label="Statuses" value={list.filters.status} onChange={(v) => list.setFilter("status", v)} options={MAINTENANCE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="Types" value={list.filters.type} onChange={(v) => list.setFilter("type", v)} options={MAINTENANCE_TYPES.map((t) => ({ value: t, label: MAINTENANCE_TYPE_LABELS[t] }))} />
          <DateRangeFilter from={list.filters.from} to={list.filters.to} onChange={(from, to) => { list.setFilter("from", from); list.setFilter("to", to); }} />
        </Toolbar>
        <DataTable
          caption="Maintenance records"
          columns={columns}
          rows={data?.items}
          rowKey={(m) => m.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          empty={{ title: list.activeFilterCount ? "No maintenance records match your filters" : "No maintenance records yet", description: "Schedule maintenance to start building the service history." }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="records" />}
      </Card>

      <FormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        title={record ? `Edit ${record.code}` : "Schedule maintenance"}
        description={record ? "Update the maintenance job." : "Book a service or repair for a vehicle."}
        size="lg"
        fields={fields}
        schema={maintenanceSchema}
        initial={{
          vehicleId: record?.vehicleId ?? form.preset?.vehicleId ?? "",
          type: record?.type ?? form.preset?.type ?? "",
          description: record?.description ?? form.preset?.description ?? "",
          serviceDate: toDateInput(record?.serviceDate ?? form.preset?.serviceDate ?? new Date()),
          provider: record?.provider ?? "",
          status: record?.status ?? "SCHEDULED",
          cost: record ? String(paiseToRupees(record.costPaise)) : "0",
          odometer: record?.odometer != null ? String(record.odometer) : "",
          nextServiceDate: toDateInput(record?.nextServiceDate),
          nextServiceOdometer: record?.nextServiceOdometer != null ? String(record.nextServiceOdometer) : "",
        }}
        submitLabel={record ? "Save changes" : "Schedule"}
        successMessage={record ? "Maintenance updated" : "Maintenance scheduled"}
        onSubmit={(values) => (record ? api.put(`/api/maintenance/${record.id}`, values) : api.post("/api/maintenance", values))}
        onSuccess={refresh}
      />

      <FormDialog
        open={!!completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        title={`Complete ${completing?.code ?? "maintenance"}`}
        description={`${completing ? typeLabel(completing.type) : ""} on ${completing?.vehicle.registrationNumber ?? ""}. The vehicle returns to service when no other job is in progress.`}
        schema={maintenanceCompleteSchema}
        fields={[
          { name: "cost", label: "Final cost (₹)", type: "number", required: true, step: "0.01", min: 0 },
          { name: "odometer", label: "Odometer at service (km)", type: "number", min: 0 },
          { name: "nextServiceDate", label: "Next service date", type: "date", section: "Follow-up reminder (optional)" },
          { name: "nextServiceOdometer", label: "Next service odometer (km)", type: "number", min: 0 },
        ]}
        initial={{
          cost: completing ? String(paiseToRupees(completing.costPaise)) : "",
          odometer: completing ? String(completing.odometer ?? completing.vehicle.odometer) : "",
          nextServiceDate: toDateInput(completing?.nextServiceDate),
          nextServiceOdometer: completing?.nextServiceOdometer != null ? String(completing.nextServiceOdometer) : "",
        }}
        submitLabel="Mark completed"
        successMessage="Maintenance completed"
        onSubmit={(values) => api.post(`/api/maintenance/${completing!.id}/complete`, values)}
        onSuccess={refresh}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === "delete" ? `Delete ${confirm.record.code}?` : `Cancel ${confirm?.record.code ?? "job"}?`}
        description={
          confirm?.kind === "delete"
            ? "This permanently removes the maintenance record. This cannot be undone."
            : "The job is marked cancelled and kept in the history. If the vehicle was in service for this job it becomes available again."
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete record" : "Cancel job"}
        loading={busy}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, record: r } = confirm;
          void act(() => (kind === "delete" ? api.del(`/api/maintenance/${r.id}`) : api.post(`/api/maintenance/${r.id}/cancel`)), kind === "delete" ? `${r.code} deleted` : `${r.code} cancelled`);
        }}
      />
    </>
  );
}
