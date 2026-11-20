"use client";

import { useState } from "react";
import { Download, Droplets, Fuel, Gauge, IndianRupee, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile, errorMessage, qs, useListState, useQuery, type Paged } from "@/lib/client";
import { formatDate, formatINR, formatKm, formatNumber, paiseToRupees, toDateInput } from "@/lib/format";
import { fuelSchema } from "@/lib/validation";
import type { fuelSummary } from "@/server/services/fuel";
import { BarSeriesChart, ChartCard, compactINR, SERIES } from "@/components/app/charts";
import { DataTable, DateRangeFilter, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { FormDialog, type FieldConfig } from "@/components/app/form-dialog";
import { FuelFlagsCard, type FuelIntel } from "@/components/app/intelligence";
import { PageHeader, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

interface FuelRow {
  id: string;
  code: string;
  vehicleId: string;
  date: string;
  quantityL: number;
  pricePerLitrePaise: number;
  totalCostPaise: number;
  odometer: number;
  station: string;
  notes: string | null;
  vehicle: { id: string; registrationNumber: string; name: string };
}
interface VehicleOption {
  id: string;
  registrationNumber: string;
  name: string;
  odometer: number;
}
type Summary = Awaited<ReturnType<typeof fuelSummary>>;

export function FuelView() {
  const can = useCan();
  const canWrite = can("fuel:write");
  const list = useListState({ filters: { vehicleId: "", from: "", to: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<FuelRow>>(`/api/fuel${list.query}`);
  const filterQuery = qs({ vehicleId: list.filters.vehicleId, from: list.filters.from, to: list.filters.to });
  const summary = useQuery<Summary>(`/api/fuel/summary${filterQuery}`);
  // Intelligence follows the date filter (default: last 180 days) but always looks at the whole fleet,
  // because a vehicle is judged against comparable vehicles.
  const intel = useQuery<FuelIntel>(`/api/intelligence/fuel${qs({ from: list.filters.from, to: list.filters.to })}`);
  const vehicles = useQuery<VehicleOption[]>("/api/vehicles/options");
  const [form, setForm] = useState<{ open: boolean; record: FuelRow | null }>({ open: false, record: null });
  const [removing, setRemoving] = useState<FuelRow | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    reload();
    summary.reload();
    intel.reload();
    vehicles.reload();
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/fuel/${removing.id}`);
      toast.success(`${removing.code} deleted`);
      setRemoving(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const file = await downloadFile(`/api/reports/fuel${qs({ from: list.filters.from || toDateInput(new Date(Date.now() - 365 * 86_400_000)), to: list.filters.to || toDateInput(new Date()) })}`);
      toast.success(`Downloaded ${file}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const fields: FieldConfig[] = [
    {
      name: "vehicleId", label: "Vehicle", type: "select", required: true, wide: true, emptyOption: "Select a vehicle…",
      options: (vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.registrationNumber} · ${v.name} (${formatNumber(v.odometer)} km)` })),
    },
    { name: "date", label: "Fuel date", type: "date", required: true, max: toDateInput(new Date()) },
    { name: "station", label: "Fuel station", required: true, placeholder: "Indian Oil, Mathura Road" },
    { name: "quantityL", label: "Quantity (litres)", type: "number", required: true, step: "0.01", min: 0 },
    { name: "pricePerLitre", label: "Price per litre (₹)", type: "number", required: true, step: "0.01", min: 0 },
    { name: "odometer", label: "Odometer reading (km)", type: "number", required: true, min: 0, hint: "Must not be lower than the previous fill" },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ];

  const columns: Column<FuelRow>[] = [
    { key: "date", header: "Date", sortKey: "date", className: "whitespace-nowrap", render: (f) => formatDate(f.date) },
    { key: "vehicle", header: "Vehicle", render: (f) => <div><p className="whitespace-nowrap font-medium">{f.vehicle.registrationNumber}</p><p className="text-xs text-ink-3">{f.vehicle.name}</p></div> },
    { key: "station", header: "Station", sortKey: "station", hideBelow: "md", render: (f) => <span className="text-ink-2">{f.station}</span> },
    { key: "qty", header: "Quantity", sortKey: "quantityL", align: "right", render: (f) => <span className="tabular">{formatNumber(f.quantityL, true)} L</span> },
    { key: "price", header: "Price / L", sortKey: "pricePerLitrePaise", align: "right", hideBelow: "sm", render: (f) => <span className="tabular">{formatINR(f.pricePerLitrePaise, true)}</span> },
    { key: "total", header: "Total cost", sortKey: "totalCostPaise", align: "right", render: (f) => <span className="tabular font-medium">{formatINR(f.totalCostPaise)}</span> },
    { key: "odo", header: "Odometer", sortKey: "odometer", align: "right", hideBelow: "lg", render: (f) => <span className="tabular">{formatNumber(f.odometer)} km</span> },
    { key: "code", header: "Record ID", sortKey: "code", hideBelow: "xl", render: (f) => <span className="text-ink-3">{f.code}</span> },
    {
      key: "actions", header: "", align: "right", className: "w-10",
      render: (f) => (
        <RowActions
          label={`Actions for ${f.code}`}
          actions={[
            { label: "Edit", icon: Pencil, onSelect: () => setForm({ open: true, record: f }), hidden: !canWrite },
            { label: "Delete", icon: Trash2, tone: "danger", separated: true, onSelect: () => setRemoving(f), hidden: !canWrite },
          ]}
        />
      ),
    },
  ];

  const t = summary.data?.totals;
  const record = form.record;
  const formTotal = (values: Record<string, string | boolean>) => {
    const total = Number(values.quantityL) * Number(values.pricePerLitre);
    return Number.isFinite(total) && total > 0 ? (
      <p className="rounded-md bg-canvas px-3 py-2 text-[13px] text-ink-2">Total cost: <strong className="font-semibold text-ink">{formatINR(Math.round(total * 100), true)}</strong></p>
    ) : null;
  };

  return (
    <>
      <PageHeader
        title="Fuel Management"
        description="Fuel fills, spend and efficiency, calculated from saved records."
        actions={
          <>
            {can("reports:export") && <Button variant="secondary" onClick={exportCsv}><Download />Export CSV</Button>}
            {canWrite && <Button onClick={() => setForm({ open: true, record: null })}><Plus />Add fuel record</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Fuel expenditure" value={formatINR(t?.totalCostPaise ?? 0)} hint={`${t?.fillCount ?? 0} fills in selection`} icon={IndianRupee} tone="warning" />
        <StatCard label="Fuel purchased" value={`${formatNumber(t?.totalLitres ?? 0, true)} L`} hint={t?.avgPricePerLitrePaise ? `Avg ${formatINR(t.avgPricePerLitrePaise, true)} per litre` : undefined} icon={Droplets} />
        <StatCard label="Average mileage" value={t?.mileageKmPerL ? `${t.mileageKmPerL.toFixed(1)} km/L` : "—"} hint={t?.distanceKm ? `Over ${formatKm(t.distanceKm)}` : "Needs two fills per vehicle"} icon={Gauge} tone="success" />
        <StatCard label="Cost per kilometre" value={t?.costPerKmPaise ? formatINR(t.costPerKmPaise, true) : "—"} hint="Fuel only, fill-to-fill method" icon={Fuel} tone="violet" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Monthly fuel expenditure" description="Total fuel spend per month (₹)" empty={!summary.data?.monthly.length}>
          <BarSeriesChart
            data={(summary.data?.monthly ?? []).map((m) => ({ label: m.label, cost: Math.round(m.costPaise / 100) }))}
            xKey="label"
            series={[{ key: "cost", label: "Fuel spend", color: SERIES[0] }]}
            format={(v) => formatINR(v * 100)}
            tickFormat={compactINR}
          />
        </ChartCard>
        <Card>
          <CardHeader title="Vehicle-wise fuel analysis" description="Mileage = distance between first and last fill ÷ litres after the first fill" />
          {/* Focusable so keyboard users can scroll it (WCAG 2.1.1). */}
          <div className="scroll-thin max-h-[268px] overflow-y-auto" tabIndex={0} role="region" aria-label="Vehicle-wise fuel analysis">
            <DataTable
              rows={summary.data?.vehicles}
              rowKey={(v) => v.vehicle.id}
              loading={summary.loading}
              error={summary.error}
              onRetry={summary.reload}
              empty={{ title: "No fuel records in this selection" }}
              columns={[
                { key: "vehicle", header: "Vehicle", render: (v) => <span className="whitespace-nowrap font-medium">{v.vehicle.registrationNumber}</span> },
                { key: "fills", header: "Fills", align: "right", render: (v) => <span className="tabular">{v.fillCount}</span> },
                { key: "litres", header: "Litres", align: "right", hideBelow: "sm", render: (v) => <span className="tabular">{formatNumber(v.totalLitres, true)}</span> },
                { key: "cost", header: "Spend", align: "right", render: (v) => <span className="tabular">{formatINR(v.totalCostPaise)}</span> },
                { key: "mileage", header: "km/L", align: "right", render: (v) => <span className="tabular">{v.mileageKmPerL ? v.mileageKmPerL.toFixed(1) : "—"}</span> },
                { key: "cpk", header: "₹/km", align: "right", render: (v) => <span className="tabular">{v.costPerKmPaise ? paiseToRupees(v.costPerKmPaise).toFixed(2) : "—"}</span> },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <FuelFlagsCard data={intel.data} loading={intel.loading} error={intel.error} onRetry={intel.reload} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Fuel history" />
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search station, vehicle, record ID…" />
          <FilterSelect
            label="Vehicles"
            value={list.filters.vehicleId}
            onChange={(v) => list.setFilter("vehicleId", v)}
            options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.registrationNumber} · ${v.name}` }))}
          />
          <DateRangeFilter from={list.filters.from} to={list.filters.to} onChange={(from, to) => { list.setFilter("from", from); list.setFilter("to", to); }} />
        </Toolbar>
        <DataTable
          caption="Fuel records"
          columns={columns}
          rows={data?.items}
          rowKey={(f) => f.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          empty={{ title: list.activeFilterCount ? "No fuel records match your filters" : "No fuel records yet", description: "Log a fuel fill to start tracking spend and mileage." }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="fuel records" />}
      </Card>

      <FormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        title={record ? `Edit ${record.code}` : "Add fuel record"}
        description="The total cost is calculated from quantity × price per litre."
        fields={fields}
        schema={fuelSchema}
        initial={{
          vehicleId: record?.vehicleId ?? list.filters.vehicleId ?? "",
          date: toDateInput(record?.date ?? new Date()),
          station: record?.station ?? "",
          quantityL: record ? String(record.quantityL) : "",
          pricePerLitre: record ? String(paiseToRupees(record.pricePerLitrePaise)) : "",
          odometer: record ? String(record.odometer) : "",
          notes: record?.notes ?? "",
        }}
        submitLabel={record ? "Save changes" : "Add record"}
        successMessage={record ? "Fuel record updated" : "Fuel record added"}
        footerNote={formTotal}
        onFieldChange={(name, value, values) => {
          // Pre-fill the odometer with the vehicle's current reading on new records.
          if (name === "vehicleId" && !record && !values.odometer) {
            const v = vehicles.data?.find((x) => x.id === value);
            if (v) return { ...values, odometer: String(v.odometer) };
          }
        }}
        onSubmit={(values) => (record ? api.put(`/api/fuel/${record.id}`, values) : api.post("/api/fuel", values))}
        onSuccess={refresh}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing?.code ?? "fuel record"}?`}
        description={`This removes the ${removing ? formatDate(removing.date) : ""} fill for ${removing?.vehicle.registrationNumber ?? "this vehicle"} and recalculates fuel analytics. This cannot be undone.`}
        confirmLabel="Delete record"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
