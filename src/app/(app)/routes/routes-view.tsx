"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Clock, Eye, ListOrdered, MapPinned, Package, Plus, Route as RouteIcon, Save, Sparkles, Trash2, TrendingDown, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { ROUTE_STATUSES, humanize } from "@/lib/constants";
import type { LatLng } from "@/lib/geo";
import { formatDateTime, formatDuration, formatKm } from "@/lib/format";
import { PLACES, placeLabel } from "@/lib/locations";
import type { getRouteById, PlannedStop } from "@/server/services/routes";
import { DataTable, FilterSelect, Pagination, SearchInput, Toolbar } from "@/components/app/data-table";
import { EmptyState, LoadingState, PageHeader, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { RowActions } from "@/components/app/row-actions";
import { StatusBadge } from "@/components/app/status-badge";
import { AssignDialog } from "@/components/forms/delivery-actions";
import { DeliveryFormDialog } from "@/components/forms/delivery-form";
import { LocationField, type LocationValue } from "@/components/forms/location-field";
import { MAP_COLORS, MapView, type MapMarker } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DeliveryRow } from "../deliveries/deliveries-view";

type Strategy = "original" | "nearestNeighbor" | "optimized";

interface Preview {
  options: { strategy: Strategy; label: string; algorithm: string; distanceKm: number; estimatedMinutes: number }[];
  selected: {
    strategy: Strategy; algorithm: string; stops: PlannedStop[]; geometry: LatLng[]; geometrySource: string;
    distanceKm: number; estimatedMinutes: number; stopCount: number; savedKm: number;
  };
}

const STOP_COLOR = { START: MAP_COLORS.start, PICKUP: MAP_COLORS.pickup, DROPOFF: MAP_COLORS.dropoff } as const;

function stopMarkers(stops: { sequence: number; type: string; label: string; lat: number; lng: number }[]): MapMarker[] {
  return stops.map((s) => ({
    id: `stop-${s.sequence}`,
    kind: "pin" as const,
    position: [s.lat, s.lng] as LatLng,
    color: STOP_COLOR[s.type as keyof typeof STOP_COLOR] ?? MAP_COLORS.route,
    label: s.type === "START" ? "S" : String(s.sequence),
    title: `${s.type === "START" ? "Start" : `Stop ${s.sequence} (${humanize(s.type)})`}: ${s.label}`,
    popup: <><strong>{s.type === "START" ? "Start" : `Stop ${s.sequence} · ${humanize(s.type)}`}</strong><br />{s.label}</>,
  }));
}

function StopList({ stops }: { stops: { sequence: number; type: string; label: string; legKm: number; deliveryCode?: string | null; delivery?: { code: string } | null }[] }) {
  return (
    <ol className="divide-y divide-line">
      {stops.map((s) => (
        <li key={s.sequence} className="flex items-center gap-3 px-4 py-2">
          <span className="tabular grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: STOP_COLOR[s.type as keyof typeof STOP_COLOR] }}>
            {s.type === "START" ? "S" : s.sequence}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{s.label}</p>
            <p className="text-xs text-ink-3">
              {s.type === "START" ? "Start point" : `${humanize(s.type)}${s.deliveryCode || s.delivery ? ` · ${s.deliveryCode ?? s.delivery?.code}` : ""}`}
            </p>
          </div>
          {s.type !== "START" && <span className="tabular shrink-0 text-xs text-ink-3">+{formatKm(s.legKm)}</span>}
        </li>
      ))}
    </ol>
  );
}

function Legend() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
      {(["START", "PICKUP", "DROPOFF"] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: STOP_COLOR[t] }} aria-hidden />{t === "START" ? "Start" : humanize(t)}</span>
      ))}
      <span>Routes are estimates for planning, not turn-by-turn navigation.</span>
    </p>
  );
}

// --- Multi-stop optimiser ---------------------------------------------------------

function Optimizer({ onSaved }: { onSaved: () => void }) {
  const can = useCan();
  const pending = useQuery<Paged<DeliveryRow & { routeId: string | null }>>("/api/deliveries?status=PENDING&pageSize=100&sort=scheduledAt&dir=asc");
  const [startId, setStartId] = useState(PLACES[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<Strategy>("optimized");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const available = useMemo(() => (pending.data?.items ?? []).filter((d) => !d.routeId), [pending.data]);
  const start = PLACES.find((p) => p.id === startId)!;
  const body = { start: { label: placeLabel(start), lat: start.lat, lng: start.lng }, deliveryIds: selectedIds };

  const toggle = (id: string) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setPreview(null);
  };

  const optimise = async (next: Strategy = strategy) => {
    setLoading(true);
    try {
      setPreview(await api.post<Preview>("/api/routes/preview", { ...body, strategy: next }));
      setStrategy(next);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="1. Choose a start point and deliveries" description="Each delivery adds a pickup and a drop-off stop." />
        <CardBody className="space-y-3">
          <div>
            <Label htmlFor="route-start">Start point (depot or vehicle location)</Label>
            <Select id="route-start" value={startId} onChange={(e) => { setStartId(e.target.value); setPreview(null); }}>
              {PLACES.map((p) => <option key={p.id} value={p.id}>{placeLabel(p)}</option>)}
            </Select>
          </div>
          <div>
            <p className="mb-1 flex items-center justify-between text-[13px] font-medium text-ink">
              Pending deliveries
              <span className="text-xs font-normal text-ink-3">{selectedIds.length} selected</span>
            </p>
            {pending.loading ? (
              <LoadingState className="py-6" />
            ) : available.length === 0 ? (
              <EmptyState icon={Package} title="No pending deliveries" description="Create deliveries first, then group them into a route here." className="py-6" />
            ) : (
              <ul className="scroll-thin max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {available.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-canvas">
                      <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggle(d.id)} className="mt-0.5 size-4 accent-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-ink">{d.code}<StatusBadge status={d.priority} /></span>
                        <span className="block truncate text-xs text-ink-3">{d.pickupAddress}</span>
                        <span className="flex items-center gap-1 truncate text-xs text-ink-3"><ArrowDown className="size-3 shrink-0" aria-hidden /><span className="truncate">{d.destinationAddress}</span></span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button className="w-full" onClick={() => optimise()} loading={loading} disabled={selectedIds.length === 0}>
            <Sparkles />
            Optimise route
          </Button>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {!preview ? (
          <Card>
            <EmptyState icon={MapPinned} title="Select deliveries and optimise" description="The planner orders the stops with a nearest-neighbour heuristic and a 2-opt improvement pass, always keeping each pickup ahead of its drop-off." className="py-20" />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader title="2. Compare route options" description="Estimated road distance for each stop order (straight-line × 1.3)" />
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                {preview.options.map((o) => {
                  const active = o.strategy === preview.selected.strategy;
                  const best = o.distanceKm === Math.min(...preview.options.map((x) => x.distanceKm));
                  return (
                    <button
                      key={o.strategy}
                      type="button"
                      onClick={() => !active && optimise(o.strategy)}
                      aria-pressed={active}
                      className={`rounded-md border p-3 text-left transition-colors ${active ? "border-primary bg-primary-soft/50" : "border-line hover:border-line-strong"}`}
                    >
                      <p className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink">
                        {o.label}
                        {best && <span className="rounded-sm bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">Shortest</span>}
                      </p>
                      <p className="tabular mt-1 text-lg font-semibold text-ink">{formatKm(o.distanceKm)}</p>
                      <p className="text-xs text-ink-3">{formatDuration(o.estimatedMinutes)} incl. stop time</p>
                    </button>
                  );
                })}
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Route distance" value={formatKm(preview.selected.distanceKm)} hint={preview.selected.geometrySource === "osrm" ? "Road distance (OSRM)" : "Offline estimate"} icon={RouteIcon} />
              <StatCard label="Estimated duration" value={formatDuration(preview.selected.estimatedMinutes)} hint="Driving + 10 min per stop" icon={Clock} tone="violet" />
              <StatCard label="Stops" value={preview.selected.stopCount} hint={`${selectedIds.length} deliveries`} icon={ListOrdered} tone="neutral" />
              <StatCard label="Saved vs. as entered" value={formatKm(preview.selected.savedKm)} hint={preview.selected.algorithm} icon={TrendingDown} tone="success" />
            </div>

            <Card>
              <CardHeader
                title="3. Review the route"
                description={`${preview.selected.stopCount} stops in visiting order`}
                action={can("routes:write") && <Button size="sm" onClick={() => setSaveOpen(true)}><Save />Save route</Button>}
              />
              <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="p-4">
                  <MapView
                    height={400}
                    fitKey={`${preview.selected.strategy}:${selectedIds.join()}:${startId}`}
                    markers={stopMarkers(preview.selected.stops)}
                    lines={[{ id: "route", points: preview.selected.geometry, color: MAP_COLORS.route, dashed: preview.selected.geometrySource !== "osrm" }]}
                  />
                  <Legend />
                </div>
                <div className="scroll-thin max-h-[460px] overflow-y-auto border-t border-line lg:border-l lg:border-t-0">
                  <StopList stops={preview.selected.stops} />
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      <SaveRouteDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        body={{ ...body, strategy }}
        defaultName={`${start.city} run · ${selectedIds.length} deliveries`}
        onSaved={() => {
          setPreview(null);
          setSelectedIds([]);
          pending.reload();
          onSaved();
        }}
      />
    </div>
  );
}

function SaveRouteDialog({
  open, onOpenChange, body, defaultName, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  body: Record<string, unknown>;
  defaultName: string;
  onSaved: () => void;
}) {
  const drivers = useQuery<{ id: string; fullName: string; status: string; vehicle: { id: string } | null }[]>(open ? "/api/drivers/options" : null);
  const vehicles = useQuery<{ id: string; registrationNumber: string; name: string; status: string }[]>(open ? "/api/vehicles/options" : null);
  const [name, setName] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(defaultName);
      setDriverId("");
      setVehicleId("");
      setErrors({});
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: "Route name is required" });
    if (!!driverId !== !!vehicleId) return setErrors({ vehicleId: "Select both a driver and a vehicle, or neither" });
    setSaving(true);
    try {
      const route = await api.post<{ code: string }>("/api/routes", { ...body, name, driverId, vehicleId });
      toast.success(`${route.code} saved${driverId ? " and assigned" : ""}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title="Save route"
      description="Assign a driver and vehicle now to dispatch every delivery on this route, or save it as a plan."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="save-route" loading={saving}>Save route</Button>
        </>
      }
    >
      <form id="save-route" onSubmit={save} className="space-y-3.5">
        {errors.form && <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{errors.form}</div>}
        <div>
          <Label htmlFor="route-name" required>Route name</Label>
          <Input id="route-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          <FieldError>{errors.name}</FieldError>
        </div>
        <div>
          <Label htmlFor="route-driver">Driver</Label>
          <Select
            id="route-driver"
            value={driverId}
            onChange={(e) => {
              setDriverId(e.target.value);
              const own = drivers.data?.find((d) => d.id === e.target.value)?.vehicle?.id;
              if (own && !vehicleId && vehicles.data?.find((v) => v.id === own)?.status === "AVAILABLE") setVehicleId(own);
            }}
          >
            <option value="">Assign later</option>
            {drivers.data?.map((d) => <option key={d.id} value={d.id} disabled={d.status !== "AVAILABLE"}>{d.fullName}{d.status === "AVAILABLE" ? "" : ` — ${humanize(d.status).toLowerCase()}`}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="route-vehicle">Vehicle</Label>
          <Select id="route-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-invalid={!!errors.vehicleId}>
            <option value="">Assign later</option>
            {vehicles.data?.map((v) => <option key={v.id} value={v.id} disabled={v.status !== "AVAILABLE"}>{v.registrationNumber} · {v.name}{v.status === "AVAILABLE" ? "" : ` — ${humanize(v.status).toLowerCase()}`}</option>)}
          </Select>
          <FieldError>{errors.vehicleId}</FieldError>
        </div>
      </form>
    </Dialog>
  );
}

// --- Point-to-point planner -------------------------------------------------------

interface PointResult {
  straightLineKm: number;
  averageSpeedKmh: number;
  options: { key: string; label: string; distanceKm: number; estimatedMinutes: number; geometry: LatLng[]; source: string }[];
}

function PointPlanner() {
  const can = useCan();
  const empty: LocationValue = { address: "", lat: "", lng: "" };
  const [pickup, setPickup] = useState<LocationValue>(empty);
  const [destination, setDestination] = useState<LocationValue>(empty);
  const [result, setResult] = useState<PointResult | null>(null);
  const [optionKey, setOptionKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const ready = pickup.lat !== "" && pickup.lng !== "" && destination.lat !== "" && destination.lng !== "";
  const calculate = async () => {
    if (!ready) return setError("Select both a pickup location and a destination.");
    if (pickup.lat === destination.lat && pickup.lng === destination.lng) return setError("Destination must differ from the pickup location.");
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<PointResult>("/api/routes/point", {
        from: { lat: Number(pickup.lat), lng: Number(pickup.lng) },
        to: { lat: Number(destination.lat), lng: Number(destination.lng) },
      });
      setResult(r);
      setOptionKey(r.options[0].key);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const reset = (setter: (v: LocationValue) => void) => (v: LocationValue) => {
    setter(v);
    setResult(null);
  };
  const option = result?.options.find((o) => o.key === optionKey) ?? result?.options[0];
  const markers: MapMarker[] = [
    ...(pickup.lat ? [{ id: "p", kind: "pin" as const, position: [Number(pickup.lat), Number(pickup.lng)] as LatLng, color: MAP_COLORS.pickup, label: "P", title: pickup.address }] : []),
    ...(destination.lat ? [{ id: "d", kind: "pin" as const, position: [Number(destination.lat), Number(destination.lng)] as LatLng, color: MAP_COLORS.dropoff, label: "D", title: destination.address }] : []),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Plan a single trip" description="Pick two points to estimate distance and travel time." />
        <CardBody className="space-y-3.5">
          <LocationField id="pp-pickup" label="Pickup location" color={MAP_COLORS.pickup} value={pickup} onChange={reset(setPickup)} />
          <LocationField id="pp-destination" label="Destination" color={MAP_COLORS.dropoff} value={destination} onChange={reset(setDestination)} />
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <Button className="w-full" onClick={calculate} loading={loading}><RouteIcon />Calculate route</Button>
          {result && option && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-[13px] font-medium text-ink">Route options</p>
              {result.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={o.key === option.key}
                  onClick={() => setOptionKey(o.key)}
                  className={`w-full rounded-md border p-2.5 text-left ${o.key === option.key ? "border-primary bg-primary-soft/50" : "border-line hover:border-line-strong"}`}
                >
                  <p className="text-xs text-ink-3">{o.label}</p>
                  <p className="tabular text-[15px] font-semibold text-ink">{formatKm(o.distanceKm)} · {formatDuration(o.estimatedMinutes)}</p>
                </button>
              ))}
              <p className="text-xs text-ink-3">
                Straight-line distance {formatKm(result.straightLineKm)}. Time assumes an average of {result.averageSpeedKmh} km/h (configurable in Settings).
              </p>
              {can("deliveries:write") && (
                <Button variant="secondary" className="w-full" onClick={() => setCreateOpen(true)}><Plus />Create delivery for this route</Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <MapView
            className="h-[60dvh] min-h-[380px]"
            height="auto"
            fitKey={`${pickup.lat},${pickup.lng},${destination.lat},${destination.lng},${option?.key ?? ""}`}
            markers={markers}
            lines={option ? [{ id: "route", points: option.geometry, color: MAP_COLORS.route, dashed: option.source !== "osrm" }] : []}
          />
          <p className="mt-2 text-xs text-ink-3">
            Solid line: road geometry from OpenStreetMap routing. Dashed line: offline estimate drawn without road data. Estimates only, not navigation instructions.
          </p>
        </CardBody>
      </Card>
      <DeliveryFormDialog open={createOpen} onOpenChange={setCreateOpen} prefill={{ pickup, destination }} onSaved={() => undefined} />
    </div>
  );
}

// --- Saved routes -----------------------------------------------------------------

interface RouteRow {
  id: string;
  code: string;
  name: string;
  status: string;
  algorithm: string;
  totalDistanceKm: number;
  estimatedMinutes: number;
  createdAt: string;
  driverId: string | null;
  vehicleId: string | null;
  driver: { fullName: string } | null;
  vehicle: { registrationNumber: string } | null;
  _count: { deliveries: number; stops: number };
}
type RouteDetail = Awaited<ReturnType<typeof getRouteById>>;

function SavedRoutes({ refreshKey }: { refreshKey: number }) {
  const can = useCan();
  const list = useListState({ filters: { status: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<RouteRow>>(`/api/routes${list.query}${list.query ? "&" : "?"}_=${refreshKey}`);
  const [viewId, setViewId] = useState<string | null>(null);
  const detail = useQuery<RouteDetail>(viewId ? `/api/routes/${viewId}` : null);
  const [assigning, setAssigning] = useState<RouteRow | null>(null);
  const [removing, setRemoving] = useState<RouteRow | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = can("routes:write");

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/routes/${removing.id}`);
      toast.success(`${removing.code} deleted; its deliveries are pending again`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Toolbar list={list}>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search route name or ID…" />
        <FilterSelect label="Statuses" value={list.filters.status} onChange={(v) => list.setFilter("status", v)} options={ROUTE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </Toolbar>
      <DataTable
        caption="Saved routes"
        rows={data?.items}
        rowKey={(r) => r.id}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRetry={reload}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        onRowClick={(r) => setViewId(r.id)}
        empty={{ title: "No saved routes", description: "Optimise a multi-stop route and save it to see it here." }}
        columns={[
          { key: "code", header: "Route", sortKey: "code", render: (r) => <div><p className="font-medium text-primary">{r.code}</p><p className="text-xs text-ink-3">{r.name}</p></div> },
          { key: "stops", header: "Stops", align: "right", render: (r) => <span className="tabular">{r._count.stops - 1}</span> },
          { key: "deliveries", header: "Deliveries", align: "right", hideBelow: "sm", render: (r) => <span className="tabular">{r._count.deliveries}</span> },
          { key: "distance", header: "Distance", sortKey: "totalDistanceKm", align: "right", render: (r) => <span className="tabular">{formatKm(r.totalDistanceKm)}</span> },
          { key: "duration", header: "Est. duration", align: "right", hideBelow: "md", render: (r) => <span className="tabular">{formatDuration(r.estimatedMinutes)}</span> },
          { key: "crew", header: "Driver / vehicle", hideBelow: "md", render: (r) => (r.driver ? <div><p>{r.driver.fullName}</p><p className="text-xs text-ink-3">{r.vehicle?.registrationNumber}</p></div> : <span className="text-ink-3">Unassigned</span>) },
          { key: "created", header: "Created", sortKey: "createdAt", hideBelow: "lg", className: "whitespace-nowrap", render: (r) => formatDateTime(r.createdAt) },
          { key: "status", header: "Status", sortKey: "status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "actions", header: "", align: "right", className: "w-10",
            render: (r) => (
              <RowActions
                label={`Actions for ${r.code}`}
                actions={[
                  { label: "View route", icon: Eye, onSelect: () => setViewId(r.id) },
                  { label: r.driverId ? "Reassign" : "Assign driver & vehicle", icon: UserPlus, onSelect: () => setAssigning(r), hidden: !canWrite || r.status !== "PLANNED" },
                  { label: "Delete", icon: Trash2, tone: "danger", separated: true, onSelect: () => setRemoving(r), hidden: !canWrite || r.status === "IN_PROGRESS" },
                ]}
              />
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="routes" />}

      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} title={detail.data ? `${detail.data.code} · ${detail.data.name}` : "Route"} size="xl"
        description={detail.data ? `${formatKm(detail.data.totalDistanceKm)} · ${formatDuration(detail.data.estimatedMinutes)} · ${detail.data.stops.length - 1} stops · ${detail.data.algorithm}` : undefined}>
        {!detail.data || detail.loading ? (
          <LoadingState />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <MapView height={400} fitKey={detail.data.id} markers={stopMarkers(detail.data.stops)} lines={[{ id: "route", points: detail.data.geometry, color: MAP_COLORS.route, dashed: true }]} />
              <Legend />
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <StatusBadge status={detail.data.status} />
                <span className="text-ink-2">{detail.data.driver ? `${detail.data.driver.fullName} · ${detail.data.vehicle?.registrationNumber}` : "No driver or vehicle assigned"}</span>
              </div>
              <div className="scroll-thin max-h-[380px] overflow-y-auto rounded-md border border-line">
                <StopList stops={detail.data.stops} />
              </div>
            </div>
          </div>
        )}
      </Dialog>
      <AssignDialog
        open={!!assigning}
        onOpenChange={(o) => !o && setAssigning(null)}
        title={`Assign ${assigning?.code ?? "route"}`}
        description="Every delivery on the route is assigned to this driver and vehicle."
        endpoint={`/api/routes/${assigning?.id}/assign`}
        current={assigning ? { driverId: assigning.driverId, vehicleId: assigning.vehicleId } : undefined}
        onSaved={reload}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.code ?? "route"}?`}
        description="The route plan is deleted. Its deliveries are kept and return to the pending pool (assigned ones are unassigned)."
        confirmLabel="Delete route"
        loading={busy}
        onConfirm={remove}
      />
    </Card>
  );
}

export function RoutesView() {
  const [tab, setTab] = useState("optimizer");
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <PageHeader title="Route Planning" description="Estimate trips, optimise multi-stop runs and assign them to a driver and vehicle." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="optimizer"><Sparkles />Multi-stop optimiser</TabsTrigger>
          <TabsTrigger value="point"><RouteIcon />Point to point</TabsTrigger>
          <TabsTrigger value="saved"><ListOrdered />Saved routes</TabsTrigger>
        </TabsList>
        <TabsContent value="optimizer">
          <Optimizer
            onSaved={() => {
              setRefreshKey((k) => k + 1);
              setTab("saved");
            }}
          />
        </TabsContent>
        <TabsContent value="point"><PointPlanner /></TabsContent>
        <TabsContent value="saved"><SavedRoutes refreshKey={refreshKey} /></TabsContent>
      </Tabs>
    </>
  );
}
