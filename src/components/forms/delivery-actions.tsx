"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, ApiClientError, errorMessage, useQuery } from "@/lib/client";
import { humanize, type DeliveryStatus } from "@/lib/constants";
import { assignSchema, issueSchema } from "@/lib/validation";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";

interface DriverOption {
  id: string;
  code: string;
  fullName: string;
  status: string;
  vehicle: { id: string; registrationNumber: string } | null;
}
interface VehicleOption {
  id: string;
  registrationNumber: string;
  name: string;
  status: string;
}

/** Assign (or reassign) a driver and vehicle. Unavailable resources are shown but cannot be selected. */
export function AssignDialog({
  open, onOpenChange, title, description, endpoint, current, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** POST target, e.g. /api/deliveries/:id/assign or /api/routes/:id/assign */
  endpoint: string;
  current?: { driverId: string | null; vehicleId: string | null };
  onSaved: () => void;
}) {
  const drivers = useQuery<DriverOption[]>(open ? "/api/drivers/options" : null);
  const vehicles = useQuery<VehicleOption[]>(open ? "/api/vehicles/options" : null);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description ?? "Only available drivers and vehicles can take a new delivery."}
      size="sm"
      schema={assignSchema}
      initial={{ driverId: current?.driverId ?? "", vehicleId: current?.vehicleId ?? "" }}
      submitLabel="Assign"
      successMessage="Assignment saved"
      fields={[
        {
          name: "driverId", label: "Driver", type: "select", required: true, wide: true, emptyOption: "Select a driver…",
          options: (drivers.data ?? []).map((d) => {
            const selectable = d.status === "AVAILABLE" || d.id === current?.driverId;
            return { value: d.id, label: `${d.fullName} (${d.code})${selectable ? "" : ` — ${humanize(d.status).toLowerCase()}`}`, disabled: !selectable };
          }),
        },
        {
          name: "vehicleId", label: "Vehicle", type: "select", required: true, wide: true, emptyOption: "Select a vehicle…",
          options: (vehicles.data ?? []).map((v) => {
            const selectable = v.status === "AVAILABLE" || v.id === current?.vehicleId;
            return { value: v.id, label: `${v.registrationNumber} · ${v.name}${selectable ? "" : ` — ${humanize(v.status).toLowerCase()}`}`, disabled: !selectable };
          }),
        },
      ]}
      onFieldChange={(name, value, values) => {
        if (name !== "driverId") return;
        // Suggest the driver's regular vehicle when it is free.
        const vehicleId = drivers.data?.find((d) => d.id === value)?.vehicle?.id;
        const vehicle = vehicles.data?.find((v) => v.id === vehicleId);
        if (vehicle && (vehicle.status === "AVAILABLE" || vehicle.id === current?.vehicleId)) return { ...values, vehicleId: vehicle.id };
      }}
      onSubmit={(values) => api.post(endpoint, values)}
      onSuccess={onSaved}
    />
  );
}

const NEEDS_REASON: DeliveryStatus[] = ["DELAYED", "FAILED", "CANCELLED"];

const STATUS_HELP: Partial<Record<DeliveryStatus, string>> = {
  PICKED_UP: "The driver has collected the consignment from the pickup location.",
  IN_TRANSIT: "The vehicle is on the road. The GPS simulator will start moving it along the route.",
  DELIVERED: "The consignment has been handed over. The driver and vehicle become available again.",
  DELAYED: "The delivery will miss its expected time. It stays active until it is delivered or failed.",
  FAILED: "The delivery could not be completed. The driver and vehicle are released.",
  CANCELLED: "The delivery is called off. The driver and vehicle are released.",
};

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delivery: { id: string; code: string; status: string; nextStatuses: string[] } | null;
  onSaved: () => void;
}

export function StatusDialog(props: StatusDialogProps) {
  if (!props.delivery) return null;
  // Remount per delivery and per opening so the form always starts clean.
  return <StatusDialogBody key={`${props.delivery.id}:${props.delivery.status}:${props.open}`} {...props} delivery={props.delivery} />;
}

function StatusDialogBody({ open, onOpenChange, delivery, onSaved }: StatusDialogProps & { delivery: NonNullable<StatusDialogProps["delivery"]> }) {
  const [status, setStatus] = React.useState(delivery.nextStatuses[0] ?? "");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [noteError, setNoteError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const needsReason = NEEDS_REASON.includes(status as DeliveryStatus);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsReason && !note.trim()) {
      setNoteError("Please give a reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/deliveries/${delivery.id}/status`, { status, note });
      toast.success(`${delivery.code} marked ${humanize(status).toLowerCase()}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors?.note) setNoteError(err.fieldErrors.note);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={`Update status · ${delivery.code}`}
      description={`Currently ${humanize(delivery.status).toLowerCase()}.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="status-form" loading={saving} variant={status === "FAILED" || status === "CANCELLED" ? "danger" : "primary"}>
            Update status
          </Button>
        </>
      }
    >
      <form id="status-form" onSubmit={submit} className="space-y-3.5">
        {error && <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</div>}
        <div>
          <Label htmlFor="next-status" required>New status</Label>
          <Select id="next-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {delivery.nextStatuses.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-3">{STATUS_HELP[status as DeliveryStatus]}</p>
        </div>
        <div>
          <Label htmlFor="status-note" required={needsReason}>{needsReason ? "Reason" : "Note (optional)"}</Label>
          <Textarea
            id="status-note"
            value={note}
            aria-invalid={!!noteError}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
            placeholder={needsReason ? "What happened?" : "Add context for the delivery history"}
          />
          <FieldError>{noteError}</FieldError>
        </div>
      </form>
    </Dialog>
  );
}

export function IssueDialog({
  open, onOpenChange, delivery, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delivery: { id: string; code: string } | null;
  onSaved: () => void;
}) {
  if (!delivery) return null;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Report an issue · ${delivery.code}`}
      description="The dispatch team is notified immediately. The delivery status does not change."
      size="sm"
      schema={issueSchema}
      initial={{ note: "" }}
      submitLabel="Report issue"
      successMessage="Issue reported to dispatch"
      fields={[{ name: "note", label: "What is the problem?", type: "textarea", required: true, wide: true, placeholder: "e.g. Consignee is not answering the phone" }]}
      onSubmit={(values) => api.post(`/api/deliveries/${delivery.id}/issue`, values)}
      onSuccess={onSaved}
    />
  );
}
