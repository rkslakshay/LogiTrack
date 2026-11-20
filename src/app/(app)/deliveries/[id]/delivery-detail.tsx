"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDot, MessageSquareWarning, Pencil, RefreshCcw, Trash2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useQuery } from "@/lib/client";
import { humanize } from "@/lib/constants";
import { syntheticPath, type LatLng } from "@/lib/geo";
import { formatDateTime, formatDuration, formatKm, timeAgo } from "@/lib/format";
import type { getDelivery } from "@/server/services/deliveries";
import { Meter } from "@/components/app/charts";
import { RiskPanel } from "@/components/app/intelligence";
import { DetailList, ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { useCan, useSocketEvent, useUser } from "@/components/app/providers";
import { StatusBadge, STATUS_COLORS } from "@/components/app/status-badge";
import { AssignDialog, IssueDialog, StatusDialog } from "@/components/forms/delivery-actions";
import { DeliveryFormDialog } from "@/components/forms/delivery-form";
import { MAP_COLORS, MapView, SimulatedBadge, type MapMarker } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

type Delivery = Awaited<ReturnType<typeof getDelivery>>;

interface LocationEvent {
  vehicleId: string;
  deliveryId: string;
  lat: number;
  lng: number;
  heading: number;
  progress: number;
  at: string;
}

const STEPS = ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] as const;

function ProgressSteps({ delivery }: { delivery: Delivery }) {
  // Where the delivery is on the main path, even when it is in a side state.
  const reached =
    delivery.status === "DELIVERED" ? 4 : delivery.pickedUpAt ? (delivery.status === "PICKED_UP" ? 2 : 3) : delivery.driverId ? 1 : 0;
  const side = ["DELAYED", "FAILED", "CANCELLED"].includes(delivery.status) ? delivery.status : null;
  return (
    <ol className="flex items-start">
      {STEPS.map((step, i) => {
        const done = i < reached || (i === reached && delivery.status === "DELIVERED");
        const current = i === reached && delivery.status !== "DELIVERED";
        const stopped = current && (side === "FAILED" || side === "CANCELLED");
        return (
          <li key={step} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i <= reached ? "bg-primary" : "bg-line"}`} />
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${
                  stopped ? "border-danger bg-danger-soft text-danger" : done ? "border-primary bg-primary text-white" : current ? "border-primary bg-surface text-primary" : "border-line bg-surface text-ink-3"
                }`}
              >
                {done ? <CheckCircle2 className="size-3.5" /> : stopped ? <AlertTriangle className="size-3" /> : <CircleDot className="size-3" />}
              </span>
              <span className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? "bg-transparent" : i < reached ? "bg-primary" : "bg-line"}`} />
            </div>
            <span className={`mt-1.5 text-[11px] font-medium sm:text-xs ${done || current ? "text-ink" : "text-ink-3"}`}>{humanize(step)}</span>
            {current && side && <span className="mt-0.5"><StatusBadge status={side} /></span>}
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_LABEL: Record<string, string> = { CREATED: "Created", ASSIGNMENT: "Assignment", UPDATED: "Updated", ISSUE: "Issue reported" };

export function DeliveryDetail({ id }: { id: string }) {
  const can = useCan();
  const user = useUser();
  const router = useRouter();
  const { data: d, loading, error, reload } = useQuery<Delivery>(`/api/deliveries/${id}`);
  const [dialog, setDialog] = useState<"edit" | "assign" | "status" | "issue" | "delete" | "unassign" | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LocationEvent | null>(null);
  const isDriver = user.role === "DRIVER";
  const back = isDriver ? { href: "/my-deliveries", label: "My deliveries" } : { href: "/deliveries", label: "Deliveries" };

  useSocketEvent<{ id?: string }>("delivery:updated", (e) => {
    if (!e.id || e.id === id) reload();
  });
  useSocketEvent<LocationEvent>("vehicle:location", (e) => {
    if (e.deliveryId === id) setLive(e);
  });

  const map = useMemo(() => {
    if (!d) return null;
    const pickup: LatLng = [d.pickupLat, d.pickupLng];
    const dest: LatLng = [d.destLat, d.destLng];
    const path = d.geometry.length > 1 ? d.geometry : syntheticPath(pickup, dest);
    const markers: MapMarker[] = [
      { id: "pickup", kind: "pin", position: pickup, color: MAP_COLORS.pickup, label: "P", title: `Pickup: ${d.pickupAddress}`, popup: <><strong>Pickup</strong><br />{d.pickupAddress}</> },
      { id: "dest", kind: "pin", position: dest, color: MAP_COLORS.dropoff, label: "D", title: `Destination: ${d.destinationAddress}`, popup: <><strong>Destination</strong><br />{d.destinationAddress}</> },
    ];
    const active = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"].includes(d.status);
    const position: LatLng | null = live ? [live.lat, live.lng] : d.vehicle?.lastLat != null && d.vehicle.lastLng != null ? [d.vehicle.lastLat, d.vehicle.lastLng] : null;
    if (active && d.vehicle && position) {
      markers.push({
        id: "vehicle", kind: "vehicle", position, heading: live?.heading, color: STATUS_COLORS.ON_DELIVERY, label: d.vehicle.registrationNumber,
        popup: <><strong>{d.vehicle.registrationNumber}</strong><br />{d.driver?.fullName}<br /><span className="text-ink-3">Simulated position</span></>,
      });
    }
    return { markers, path };
  }, [d, live]);

  if (error) return <><PageHeader title="Delivery" back={back} /><Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !d || !map) return <><PageHeader title="Delivery" back={back} /><LoadingState /></>;

  const closed = ["DELIVERED", "FAILED", "CANCELLED"].includes(d.status);
  const progress = d.status === "DELIVERED" ? 1 : (live?.progress ?? d.progress);
  const late = d.deliveredAt ? new Date(d.deliveredAt) > new Date(d.expectedAt) : !closed && new Date() > new Date(d.expectedAt);
  const canWrite = can("deliveries:write");

  const run = async (action: () => Promise<unknown>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setDialog(null);
      (after ?? reload)();
    } catch (err) {
      toast.error(errorMessage(err));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={back}
        title={<span className="flex flex-wrap items-center gap-2.5">{d.code}<StatusBadge status={d.status} /><StatusBadge status={d.priority} label={`${humanize(d.priority)} priority`} /></span>}
        description={`${d.customerName} · created ${timeAgo(d.createdAt)}${d.createdBy ? ` by ${d.createdBy.name}` : ""}`}
        actions={
          <>
            {d.nextStatuses.length > 0 && <Button onClick={() => setDialog("status")}><RefreshCcw />Update status</Button>}
            {d.canAssign && <Button variant="secondary" onClick={() => setDialog("assign")}><UserPlus />{d.status === "ASSIGNED" ? "Reassign" : "Assign"}</Button>}
            {canWrite && d.status === "ASSIGNED" && <Button variant="secondary" onClick={() => setDialog("unassign")}><UserMinus />Unassign</Button>}
            {!closed && <Button variant="secondary" onClick={() => setDialog("issue")}><MessageSquareWarning />Report issue</Button>}
            {canWrite && !closed && <Button variant="secondary" onClick={() => setDialog("edit")}><Pencil />Edit</Button>}
            {canWrite && (d.status === "PENDING" || d.status === "CANCELLED") && <Button variant="danger-ghost" onClick={() => setDialog("delete")}><Trash2 />Delete</Button>}
          </>
        }
      />

      <Card>
        <CardBody>
          <ProgressSteps delivery={d} />
          {d.pickedUpAt && !closed && (
            <div className="mx-auto mt-4 max-w-xl">
              <div className="mb-1 flex justify-between text-xs text-ink-3">
                <span>Route progress (simulated)</span>
                <span className="tabular font-medium text-ink">{Math.round(progress * 100)}% · {formatKm(d.distanceKm * progress)} of {formatKm(d.distanceKm)}</span>
              </div>
              <Meter value={progress * 100} label="Route progress" />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader title="Route" description="Estimated route for planning. Not turn-by-turn navigation." action={!closed && d.vehicle ? <SimulatedBadge /> : undefined} />
            <CardBody>
              <MapView
                height={340}
                fitKey={`${d.id}:${d.geometry.length}`}
                markers={map.markers}
                lines={[{ id: "route", points: map.path, color: closed ? MAP_COLORS.done : MAP_COLORS.route, dashed: d.geometrySource !== "osrm" }]}
              />
              <p className="mt-2 text-xs text-ink-3">
                {d.geometrySource === "osrm" ? "Road geometry from OpenStreetMap routing (OSRM)." : "Dashed line: offline estimate, drawn without road data."}{" "}
                Distance and time are approximate.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Customer", value: d.customerName },
                  { label: "Customer phone", value: d.customerPhone },
                  { label: "Pickup location", value: d.pickupAddress },
                  { label: "Destination", value: d.destinationAddress },
                  { label: "Pickup coordinates", value: `${d.pickupLat.toFixed(5)}, ${d.pickupLng.toFixed(5)}` },
                  { label: "Destination coordinates", value: `${d.destLat.toFixed(5)}, ${d.destLng.toFixed(5)}` },
                  { label: "Scheduled", value: formatDateTime(d.scheduledAt) },
                  { label: "Expected delivery", value: <span className={late && !d.deliveredAt ? "text-danger" : undefined}>{formatDateTime(d.expectedAt)}</span> },
                  { label: "Picked up", value: formatDateTime(d.pickedUpAt) },
                  {
                    label: "Actual delivery",
                    value: d.deliveredAt ? <span>{formatDateTime(d.deliveredAt)} <StatusBadge status={late ? "DELAYED" : "DELIVERED"} label={late ? "Late" : "On time"} /></span> : "—",
                  },
                  { label: "Distance (approx.)", value: formatKm(d.distanceKm) },
                  { label: "Estimated travel time", value: formatDuration(d.estimatedMinutes) },
                ]}
              />
              {d.notes && (
                <div className="mt-4 rounded-md bg-canvas px-3 py-2">
                  <p className="text-xs font-medium text-ink-3">Delivery instructions</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{d.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <RiskPanel risk={d.risk} />
          <Card>
            <CardHeader title="Assignment" />
            <CardBody>
              {d.driver && d.vehicle ? (
                <DetailList
                  columns={1}
                  items={[
                    {
                      label: "Driver",
                      value: can("drivers:read") ? <Link href={`/drivers/${d.driver.id}`} className="text-primary hover:underline">{d.driver.fullName} ({d.driver.code})</Link> : `${d.driver.fullName} (${d.driver.code})`,
                    },
                    { label: "Driver phone", value: d.driver.phone },
                    {
                      label: "Vehicle",
                      value: can("vehicles:read") ? <Link href={`/vehicles/${d.vehicle.id}`} className="text-primary hover:underline">{d.vehicle.registrationNumber} · {d.vehicle.name}</Link> : `${d.vehicle.registrationNumber} · ${d.vehicle.name}`,
                    },
                    ...(d.route ? [{ label: "Part of route", value: `${d.route.code} · ${d.route.name}` }] : []),
                  ]}
                />
              ) : (
                <div className="text-[13px] text-ink-3">
                  <p>No driver or vehicle assigned yet.</p>
                  {d.canAssign && <Button size="sm" className="mt-3" onClick={() => setDialog("assign")}><UserPlus />Assign now</Button>}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery history" description="Every event recorded for this delivery" />
            <ol className="px-4 py-3">
              {d.events.map((event, i) => (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < d.events.length - 1 && <span className="absolute left-[5px] top-3.5 h-full w-px bg-line" aria-hidden />}
                  <span className={`relative mt-1 size-[11px] shrink-0 rounded-full border-2 border-surface ring-1 ${event.type === "ISSUE" ? "bg-warning ring-warning" : "bg-primary ring-primary"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {event.type === "STATUS_CHANGE" && event.status ? <StatusBadge status={event.status} /> : <span className="text-[13px] font-medium text-ink">{EVENT_LABEL[event.type] ?? humanize(event.type)}</span>}
                      <span className="text-xs text-ink-3">{formatDateTime(event.createdAt)}</span>
                    </div>
                    {event.note && <p className="mt-0.5 text-[13px] text-ink-2">{event.note}</p>}
                    <p className="text-xs text-ink-3">{event.user ? event.user.name : "System"}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <DeliveryFormDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} delivery={d} onSaved={reload} />
      <AssignDialog
        open={dialog === "assign"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Assign ${d.code}`}
        endpoint={`/api/deliveries/${d.id}/assign`}
        current={{ driverId: d.driverId, vehicleId: d.vehicleId }}
        onSaved={reload}
      />
      <StatusDialog open={dialog === "status"} onOpenChange={(o) => !o && setDialog(null)} delivery={d} onSaved={reload} />
      <IssueDialog open={dialog === "issue"} onOpenChange={(o) => !o && setDialog(null)} delivery={d} onSaved={reload} />
      <ConfirmDialog
        open={dialog === "unassign"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Unassign ${d.code}?`}
        description={`${d.driver?.fullName ?? "The driver"} and ${d.vehicle?.registrationNumber ?? "the vehicle"} will be released and the delivery returns to pending.`}
        confirmLabel="Unassign"
        tone="primary"
        loading={busy}
        onConfirm={() => run(() => api.del(`/api/deliveries/${d.id}/assign`), `${d.code} returned to pending`)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${d.code}?`}
        description="This permanently removes the delivery and its event history. This cannot be undone."
        confirmLabel="Delete delivery"
        loading={busy}
        onConfirm={() => run(() => api.del(`/api/deliveries/${d.id}`), `${d.code} deleted`, () => router.push("/deliveries"))}
      />
    </>
  );
}
