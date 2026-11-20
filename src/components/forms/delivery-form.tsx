"use client";

import * as React from "react";
import { addMinutes } from "date-fns";
import { Clock, Route } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError, errorMessage, useDebounced, useQuery } from "@/lib/client";
import { PRIORITIES, humanize } from "@/lib/constants";
import { formatDuration, formatKm, toDateTimeInput } from "@/lib/format";
import { deliverySchema } from "@/lib/validation";
import { FormField, type FieldConfig } from "@/components/app/form-dialog";
import { MAP_COLORS } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LocationField, type LocationValue } from "./location-field";

export interface DeliveryRecord {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  destinationAddress: string;
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  scheduledAt: string | Date;
  expectedAt: string | Date;
  priority: string;
  notes: string | null;
  pickedUpAt?: string | Date | null;
}

export interface DeliveryPrefill {
  pickup?: LocationValue;
  destination?: LocationValue;
}

interface Option {
  id: string;
  status: string;
}
interface DriverOption extends Option {
  code: string;
  fullName: string;
  vehicle: { id: string; registrationNumber: string } | null;
}
interface VehicleOption extends Option {
  registrationNumber: string;
  name: string;
}
interface Estimate {
  options: { label: string; distanceKm: number; estimatedMinutes: number; source: string }[];
}

const emptyLocation: LocationValue = { address: "", lat: "", lng: "" };

function initialState(delivery?: DeliveryRecord | null, prefill?: DeliveryPrefill) {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(0, 0, 0);
  return {
    customerName: delivery?.customerName ?? "",
    customerPhone: delivery?.customerPhone ?? "",
    scheduledAt: toDateTimeInput(delivery?.scheduledAt ?? start),
    expectedAt: toDateTimeInput(delivery?.expectedAt ?? addMinutes(start, 240)),
    priority: delivery?.priority ?? "NORMAL",
    notes: delivery?.notes ?? "",
    driverId: "",
    vehicleId: "",
    pickup: delivery
      ? { address: delivery.pickupAddress, lat: String(delivery.pickupLat), lng: String(delivery.pickupLng) }
      : (prefill?.pickup ?? emptyLocation),
    destination: delivery
      ? { address: delivery.destinationAddress, lat: String(delivery.destLat), lng: String(delivery.destLng) }
      : (prefill?.destination ?? emptyLocation),
  };
}

interface DeliveryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delivery?: DeliveryRecord | null;
  prefill?: DeliveryPrefill;
  onSaved: (saved: { id: string; code: string }) => void;
}

export function DeliveryFormDialog(props: DeliveryFormProps) {
  // Remount each time the dialog opens so the form starts from the current delivery / prefill.
  return <DeliveryFormBody key={`${props.delivery?.id ?? "new"}:${props.open}`} {...props} />;
}

function DeliveryFormBody({ open, onOpenChange, delivery, prefill, onSaved }: DeliveryFormProps) {
  const [values, setValues] = React.useState(() => initialState(delivery, prefill));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const formId = React.useId();
  const isEdit = !!delivery;
  const locked = !!delivery?.pickedUpAt;

  const drivers = useQuery<DriverOption[]>(open && !isEdit ? "/api/drivers/options" : null);
  const vehicles = useQuery<VehicleOption[]>(open && !isEdit ? "/api/vehicles/options" : null);

  // Live distance / time estimate once both ends are known.
  const points = useDebounced(`${values.pickup.lat},${values.pickup.lng};${values.destination.lat},${values.destination.lng}`, 500);
  const [fetched, setFetched] = React.useState<{ points: string; option: Estimate["options"][number] | null } | null>(null);
  const [endA, endB] = points.split(";").map((s) => s.split(",").map(Number));
  const pointsValid =
    points.split(/[;,]/).every((s) => s !== "") && [...endA, ...endB].every(Number.isFinite) && !(endA[0] === endB[0] && endA[1] === endB[1]);
  React.useEffect(() => {
    if (!open || !pointsValid) return;
    const [from, to] = points.split(";").map((s) => s.split(",").map(Number));
    let cancelled = false;
    api
      .post<Estimate>("/api/routes/point", { from: { lat: from[0], lng: from[1] }, to: { lat: to[0], lng: to[1] } })
      .then((result) => !cancelled && setFetched({ points, option: result.options[0] ?? null }))
      .catch(() => !cancelled && setFetched({ points, option: null }));
    return () => {
      cancelled = true;
    };
  }, [points, pointsValid, open]);
  // Only show an estimate that belongs to the points currently in the form.
  const estimate = pointsValid && fetched?.points === points ? fetched.option : null;

  const set = (name: string, value: string | boolean | LocationValue) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      // Picking a driver suggests their regular vehicle when it is free.
      if (name === "driverId" && !prev.vehicleId) {
        const vehicleId = drivers.data?.find((d) => d.id === value)?.vehicle?.id;
        if (vehicleId && vehicles.data?.find((v) => v.id === vehicleId)?.status === "AVAILABLE") next.vehicleId = vehicleId;
      }
      return next;
    });
    setErrors((e) => ({ ...e, [name]: "", ...(name === "pickup" ? { pickupAddress: "", pickupLat: "", pickupLng: "" } : {}), ...(name === "destination" ? { destinationAddress: "", destLat: "", destLng: "" } : {}) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = deliverySchema.safeParse({
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      pickupAddress: values.pickup.address,
      destinationAddress: values.destination.address,
      pickupLat: values.pickup.lat === "" ? undefined : values.pickup.lat,
      pickupLng: values.pickup.lng === "" ? undefined : values.pickup.lng,
      destLat: values.destination.lat === "" ? undefined : values.destination.lat,
      destLng: values.destination.lng === "" ? undefined : values.destination.lng,
      scheduledAt: values.scheduledAt || undefined,
      expectedAt: values.expectedAt || undefined,
      priority: values.priority,
      notes: values.notes,
      driverId: values.driverId,
      vehicleId: values.vehicleId,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
      setErrors(fieldErrors);
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit
        ? await api.put<{ id: string; code: string }>(`/api/deliveries/${delivery.id}`, parsed.data)
        : await api.post<{ id: string; code: string }>("/api/deliveries", parsed.data);
      toast.success(isEdit ? `${saved.code} updated` : `${saved.code} created`);
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (config: FieldConfig) => (
    <FormField
      key={config.name}
      field={config}
      idPrefix={formId}
      value={(values as unknown as Record<string, string>)[config.name] ?? ""}
      error={errors[config.name]}
      onChange={(v) => set(config.name, v)}
    />
  );
  const pickupError = errors.pickupAddress || errors.pickupLat || errors.pickupLng;
  const destError = errors.destinationAddress || errors.destLat || errors.destLng;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={isEdit ? `Edit ${delivery.code}` : "Create delivery"}
      description={isEdit ? "Update the delivery details." : "Enter the consignment details. A driver and vehicle can be assigned now or later."}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form={formId} loading={saving}>{isEdit ? "Save changes" : "Create delivery"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {formError && (
          <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger sm:col-span-2">{formError}</div>
        )}
        {field({ name: "customerName", label: "Customer name", required: true, placeholder: "Sharma Electronics" })}
        {field({ name: "customerPhone", label: "Customer phone", type: "tel", required: true, placeholder: "+91 98765 43210" })}

        {locked ? (
          <p className="rounded-md bg-neutral-soft px-3 py-2 text-[13px] text-ink-2 sm:col-span-2">
            Pickup and destination are locked because the goods have already been picked up: {delivery?.pickupAddress} → {delivery?.destinationAddress}
          </p>
        ) : (
          <>
            <LocationField id={`${formId}-pickup`} label="Pickup location" color={MAP_COLORS.pickup} value={values.pickup} onChange={(v) => set("pickup", v)} error={pickupError} />
            <LocationField id={`${formId}-destination`} label="Destination" color={MAP_COLORS.dropoff} value={values.destination} onChange={(v) => set("destination", v)} error={destError} />
          </>
        )}

        {estimate && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-line bg-canvas/60 px-3 py-2 text-[13px] text-ink-2 sm:col-span-2">
            <span className="flex items-center gap-1.5"><Route className="size-4 text-primary" aria-hidden />Approx. <strong className="font-semibold text-ink">{formatKm(estimate.distanceKm)}</strong></span>
            <span className="flex items-center gap-1.5"><Clock className="size-4 text-primary" aria-hidden />Est. travel time <strong className="font-semibold text-ink">{formatDuration(estimate.estimatedMinutes)}</strong></span>
            <span className="text-xs text-ink-3">{estimate.source === "osrm" ? "Road estimate via OpenStreetMap routing" : "Offline estimate (straight line × 1.3)"}</span>
            {values.scheduledAt && (
              <Button
                variant="link"
                size="sm"
                className="ml-auto h-auto p-0"
                onClick={() => set("expectedAt", toDateTimeInput(addMinutes(new Date(values.scheduledAt), estimate.estimatedMinutes + 60)))}
              >
                Set expected time from estimate
              </Button>
            )}
          </div>
        )}

        {field({ name: "scheduledAt", label: "Scheduled date & time", type: "datetime-local", required: true })}
        {field({ name: "expectedAt", label: "Expected delivery time", type: "datetime-local", required: true })}
        {field({ name: "priority", label: "Priority", type: "select", required: true, emptyOption: null, options: PRIORITIES.map((p) => ({ value: p, label: humanize(p) })) })}
        {field({ name: "notes", label: "Delivery notes / instructions", type: "textarea", wide: true, placeholder: "Unloading bay, contact person, handling instructions…" })}

        {!isEdit && (
          <>
            <p className="mt-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3 sm:col-span-2">Assignment (optional)</p>
            {field({
              name: "driverId", label: "Driver", type: "select", emptyOption: "Assign later",
              hint: "Only available drivers can be selected",
              options: (drivers.data ?? []).map((d) => ({
                value: d.id,
                label: `${d.fullName}${d.status === "AVAILABLE" ? "" : ` — ${humanize(d.status).toLowerCase()}`}`,
                disabled: d.status !== "AVAILABLE",
              })),
            })}
            {field({
              name: "vehicleId", label: "Vehicle", type: "select", emptyOption: "Assign later",
              hint: "Only available vehicles can be selected",
              options: (vehicles.data ?? []).map((v) => ({
                value: v.id,
                label: `${v.registrationNumber} · ${v.name}${v.status === "AVAILABLE" ? "" : ` — ${humanize(v.status).toLowerCase()}`}`,
                disabled: v.status !== "AVAILABLE",
              })),
            })}
          </>
        )}
      </form>
    </Dialog>
  );
}
