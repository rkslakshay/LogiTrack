"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Crosshair, Maximize2, Navigation, Pause, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useQuery } from "@/lib/client";
import { VEHICLE_STATUSES, VEHICLE_TYPE_LABELS, humanize, type VehicleType } from "@/lib/constants";
import { formatDateTime, formatKm, formatTime, timeAgo } from "@/lib/format";
import type { SimulatorState } from "@/server/simulator";
import type { FleetVehicle } from "@/server/services/tracking";
import { Meter } from "@/components/app/charts";
import { FilterSelect, SearchInput } from "@/components/app/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { useCan, useDemo, useRealtime, useSocketEvent } from "@/components/app/providers";
import { STATUS_COLORS, StatusBadge } from "@/components/app/status-badge";
import { MAP_COLORS, MapView, SimulatedBadge, type MapLine, type MapMarker } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Snapshot {
  vehicles: FleetVehicle[];
  simulator: SimulatorState;
  generatedAt: string;
}

interface LocationEvent {
  vehicleId: string;
  deliveryId: string;
  lat: number;
  lng: number;
  heading: number;
  progress: number;
  at: string;
}

export function TrackingView({ initialVehicleId }: { initialVehicleId: string | null }) {
  const can = useCan();
  const demo = useDemo();
  const { connected } = useRealtime();
  const { data, loading, error, reload, setData } = useQuery<Snapshot>("/api/tracking");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialVehicleId);
  const [focusKey, setFocusKey] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const [toggling, setToggling] = useState(false);

  // Markers move in place as simulator updates arrive: no refetch, no page refresh.
  // The simulator sends one event per moving vehicle on every tick; they are collected and applied
  // in a single state update per animation frame, so the page renders once per tick, not once per vehicle.
  const pending = useRef(new Map<string, LocationEvent>());
  const frame = useRef<number | null>(null);
  useSocketEvent<LocationEvent>("vehicle:location", (e) => {
    pending.current.set(e.vehicleId, e);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const batch = pending.current;
      pending.current = new Map();
      setData((prev) =>
        prev
          ? {
              ...prev,
              vehicles: prev.vehicles.map((v) => {
                const update = batch.get(v.id);
                if (!update) return v;
                return {
                  ...v, lat: update.lat, lng: update.lng, heading: update.heading, lastLocationAt: update.at as unknown as Date,
                  delivery: v.delivery && v.delivery.id === update.deliveryId ? { ...v.delivery, progress: update.progress } : v.delivery,
                };
              }),
            }
          : prev,
      );
    });
  });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  // Status changes (assigned, delivered...) alter who is on the map and why.
  useSocketEvent("delivery:updated", reload);
  useSocketEvent<SimulatorState>("simulator:state", (state) => setData((prev) => (prev ? { ...prev, simulator: state } : prev)));

  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(
      (v) =>
        (!status || v.status === status) &&
        (!q ||
          v.registrationNumber.toLowerCase().includes(q) ||
          v.name.toLowerCase().includes(q) ||
          (v.driver?.fullName.toLowerCase().includes(q) ?? false) ||
          (v.delivery?.code.toLowerCase().includes(q) ?? false)),
    );
  }, [vehicles, search, status]);
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    setFocusKey((k) => k + 1);
  };

  const markers: MapMarker[] = filtered.map((v) => ({
    id: v.id,
    kind: "vehicle",
    position: [v.lat, v.lng],
    heading: v.heading,
    color: STATUS_COLORS[v.status] ?? "#64748b",
    label: v.registrationNumber,
    selected: v.id === selectedId,
    title: `${v.registrationNumber} · ${humanize(v.status)}`,
  }));
  const lines: MapLine[] = [];
  if (selected?.delivery) {
    const d = selected.delivery;
    lines.push({ id: "route", points: d.geometry.length > 1 ? d.geometry : [d.pickup, d.destination], color: MAP_COLORS.route, dashed: d.geometrySource !== "osrm" });
    markers.push(
      { id: "sel-pickup", kind: "pin", position: d.pickup, color: MAP_COLORS.pickup, label: "P", title: `Pickup: ${d.pickupAddress}` },
      { id: "sel-dest", kind: "pin", position: d.destination, color: MAP_COLORS.dropoff, label: "D", title: `Destination: ${d.destinationAddress}` },
    );
  }

  const toggleSimulator = async () => {
    if (!data) return;
    setToggling(true);
    try {
      const state = await api.post<SimulatorState>("/api/simulator", { action: data.simulator.running ? "pause" : "start" });
      setData((prev) => (prev ? { ...prev, simulator: state } : prev));
      toast.success(state.running ? "GPS simulation resumed" : "GPS simulation paused");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  const restart = async () => {
    setToggling(true);
    try {
      await api.post<SimulatorState>("/api/simulator", { action: "restart" });
      toast.success("Trips rewound to their starting points");
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  const header = <PageHeader title="Live Tracking" description="Vehicle positions on OpenStreetMap, updated in real time by the GPS simulator." />;
  if (error) return <>{header}<Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !data) return <>{header}<LoadingState label="Loading fleet positions…" /></>;

  const sim = data.simulator;
  const moving = vehicles.filter((v) => v.delivery?.moving).length;

  return (
    <>
      {header}
      <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <SimulatedBadge />
        <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <span className={`size-2 rounded-full ${sim.running ? "animate-pulse bg-success" : "bg-ink-3"}`} aria-hidden />
          Simulator <strong className="font-semibold text-ink">{sim.running ? "running" : "paused"}</strong>
        </span>
        <span className="text-[13px] text-ink-3">
          {moving} vehicle{moving === 1 ? "" : "s"} moving · {sim.speed}× speed · {sim.averageSpeedKmh} km/h average · update every {sim.tickMs / 1000}s
        </span>
        {!connected && <span className="text-[13px] text-warning">Live connection lost: reconnecting…</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setFitKey((k) => k + 1)}><Maximize2 />Fit all</Button>
          {can("simulator:control") && demo.enabled && (
            <Button variant="secondary" size="sm" onClick={restart} disabled={toggling} title="Rewind the trips that are on the road to their starting points">
              <RotateCcw />
              Restart trips
            </Button>
          )}
          {can("simulator:control") && (
            <Button size="sm" variant={sim.running ? "secondary" : "primary"} onClick={toggleSimulator} loading={toggling}>
              {sim.running ? <Pause /> : <Play />}
              {sim.running ? "Pause simulation" : "Resume simulation"}
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative">
          <MapView
            className="h-[52dvh] min-h-[380px] lg:h-[calc(100dvh-235px)]"
            height="auto"
            markers={markers}
            lines={lines}
            fitKey={fitKey}
            focus={selected ? { position: [selected.lat, selected.lng], key: focusKey, zoom: 12 } : null}
            onMarkerClick={(id) => !id.startsWith("sel-") && setSelectedId(id)}
          />
          <div className="pointer-events-none absolute bottom-6 left-3 z-[400] flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-surface/95 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-card">
            {VEHICLE_STATUSES.map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: STATUS_COLORS[s] }} aria-hidden />
                {humanize(s)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-235px)]">
          {selected && (
            <Card className="shrink-0">
              <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">{selected.registrationNumber}<StatusBadge status={selected.status} /></p>
                  <p className="truncate text-xs text-ink-3">{selected.name} · {VEHICLE_TYPE_LABELS[selected.type as VehicleType] ?? selected.type}</p>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="rounded-md p-1 text-ink-3 hover:bg-neutral-soft hover:text-ink" aria-label="Close vehicle details">
                  <X className="size-4" />
                </button>
              </div>
              <dl className="space-y-2 px-4 py-3 text-[13px]">
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Driver</dt><dd className="text-right font-medium text-ink">{selected.driver ? `${selected.driver.fullName} · ${selected.driver.phone}` : "Unassigned"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Coordinates</dt><dd className="tabular text-right font-medium text-ink">{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Last update</dt><dd className="text-right font-medium text-ink" title={formatDateTime(selected.lastLocationAt)}>{formatTime(selected.lastLocationAt)} ({timeAgo(selected.lastLocationAt)})</dd></div>
              </dl>
              {selected.delivery ? (
                <div className="border-t border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/deliveries/${selected.delivery.id}`} className="text-[13px] font-semibold text-primary hover:underline">{selected.delivery.code}</Link>
                    <StatusBadge status={selected.delivery.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">{selected.delivery.customerName}</p>
                  <p className="mt-2 text-xs text-ink-3">Destination</p>
                  <p className="text-[13px] font-medium text-ink">{selected.delivery.destinationAddress}</p>
                  <div className="mt-2.5">
                    <div className="mb-1 flex justify-between text-xs text-ink-3">
                      <span>Progress</span>
                      <span className="tabular font-medium text-ink">{Math.round(selected.delivery.progress * 100)}% of {formatKm(selected.delivery.distanceKm)}</span>
                    </div>
                    <Meter value={selected.delivery.progress * 100} label="Delivery progress" />
                  </div>
                  <p className="mt-2 text-xs text-ink-3">Expected by {formatDateTime(selected.delivery.expectedAt)}</p>
                  {!selected.delivery.moving && <p className="mt-1 text-xs text-ink-3">Waiting to depart: the vehicle moves once the delivery is in transit.</p>}
                </div>
              ) : (
                <p className="border-t border-line px-4 py-3 text-[13px] text-ink-3">No active delivery. Parked at its last known location.</p>
              )}
              <div className="flex gap-2 border-t border-line px-4 py-2.5">
                <Button variant="secondary" size="sm" onClick={() => setFocusKey((k) => k + 1)}><Crosshair />Centre on map</Button>
                {can("vehicles:read") && <Button asChild variant="ghost" size="sm"><Link href={`/vehicles/${selected.id}`}>Vehicle details</Link></Button>}
              </div>
            </Card>
          )}

          <Card className="flex min-h-64 flex-1 flex-col overflow-hidden">
            <div className="space-y-2 border-b border-line p-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search vehicle, driver, delivery…" className="sm:w-full" />
              <FilterSelect label="Statuses" value={status} onChange={setStatus} options={VEHICLE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} className="sm:w-full" />
            </div>
            <ul className="scroll-thin flex-1 divide-y divide-line overflow-y-auto" aria-label="Vehicles">
              {filtered.length === 0 && <EmptyState icon={Navigation} title="No vehicles match" description="Adjust the search or status filter." className="py-8" />}
              {filtered.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => select(v.id)}
                    aria-pressed={v.id === selectedId}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-canvas ${v.id === selectedId ? "bg-primary-soft/60" : ""}`}
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[v.status] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{v.registrationNumber}</span>
                      <span className="block truncate text-xs text-ink-3">{v.driver?.fullName ?? "No driver"}{v.delivery ? ` · ${v.delivery.code}` : ""}</span>
                    </span>
                    <StatusBadge status={v.delivery?.moving ? v.delivery.status : v.status} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-3 py-2 text-xs text-ink-3">{filtered.length} of {vehicles.length} vehicles shown</p>
          </Card>
        </div>
      </div>
    </>
  );
}
