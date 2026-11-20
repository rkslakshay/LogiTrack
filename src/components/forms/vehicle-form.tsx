"use client";

import { api, useQuery } from "@/lib/client";
import { FUEL_TYPES, FUEL_TYPE_LABELS, VEHICLE_TYPES, VEHICLE_TYPE_LABELS, humanize } from "@/lib/constants";
import { toDateInput } from "@/lib/format";
import { PLACES, placeLabel } from "@/lib/locations";
import { vehicleSchema } from "@/lib/validation";
import { FormDialog, type FieldConfig, type FormValues } from "@/components/app/form-dialog";

export interface VehicleRecord {
  id: string;
  registrationNumber: string;
  name: string;
  type: string;
  manufacturer: string;
  model: string;
  year: number;
  fuelType: string;
  fuelCapacity: number;
  odometer: number;
  status: string;
  insuranceExpiry: string | Date;
  registrationExpiry: string | Date;
  assignedDriverId: string | null;
  lastLat: number | null;
  lastLng: number | null;
}

interface DriverOption {
  id: string;
  code: string;
  fullName: string;
  status: string;
  vehicle: { id: string; registrationNumber: string } | null;
}

export function VehicleFormDialog({
  open, onOpenChange, vehicle, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: VehicleRecord | null;
  onSaved: () => void;
}) {
  const drivers = useQuery<DriverOption[]>(open ? "/api/drivers/options" : null);
  const onDelivery = vehicle?.status === "ON_DELIVERY";

  const fields: FieldConfig[] = [
    { name: "registrationNumber", label: "Registration number", required: true, placeholder: "MH 12 AB 1234", hint: "Indian registration format" },
    { name: "name", label: "Vehicle name", required: true, placeholder: "Pune City 2" },
    { name: "type", label: "Vehicle type", type: "select", required: true, options: VEHICLE_TYPES.map((t) => ({ value: t, label: VEHICLE_TYPE_LABELS[t] })) },
    { name: "fuelType", label: "Fuel type", type: "select", required: true, options: FUEL_TYPES.map((t) => ({ value: t, label: FUEL_TYPE_LABELS[t] })) },
    { name: "manufacturer", label: "Manufacturer", required: true, placeholder: "Tata" },
    { name: "model", label: "Model", required: true, placeholder: "Ace Gold" },
    { name: "year", label: "Manufacturing year", type: "number", required: true, min: 1990 },
    { name: "fuelCapacity", label: "Fuel capacity (L)", type: "number", required: true, step: "0.1", min: 0 },
    { name: "odometer", label: "Current odometer (km)", type: "number", required: true, min: 0 },
    {
      name: "status", label: "Status", type: "select", required: true, emptyOption: null, disabled: onDelivery,
      hint: onDelivery ? "On a delivery: status is managed by the delivery workflow" : undefined,
      options: ["AVAILABLE", "MAINTENANCE", "INACTIVE"].map((s) => ({ value: s, label: humanize(s) })),
    },
    { name: "insuranceExpiry", label: "Insurance expiry", type: "date", required: true },
    { name: "registrationExpiry", label: "Registration expiry", type: "date", required: true },
    {
      name: "assignedDriverId", label: "Assigned driver", type: "select", emptyOption: "Unassigned",
      hint: "Choosing a driver who already has a vehicle moves them to this one",
      options: (drivers.data ?? [])
        .filter((d) => d.status !== "INACTIVE" || d.id === vehicle?.assignedDriverId)
        .map((d) => ({
          value: d.id,
          label: `${d.fullName} (${d.code})${d.vehicle && d.vehicle.id !== vehicle?.id ? ` — currently ${d.vehicle.registrationNumber}` : ""}`,
        })),
    },
    {
      name: "basePlace", label: "Base location", type: "select", emptyOption: vehicle ? "Keep current location" : "Not set",
      hint: "Where the vehicle is parked; used as its position on the live map",
      options: PLACES.map((p) => ({ value: p.id, label: placeLabel(p) })),
    },
  ];

  const initial: FormValues = {
    registrationNumber: vehicle?.registrationNumber ?? "",
    name: vehicle?.name ?? "",
    type: vehicle?.type ?? "",
    fuelType: vehicle?.fuelType ?? "",
    manufacturer: vehicle?.manufacturer ?? "",
    model: vehicle?.model ?? "",
    year: String(vehicle?.year ?? new Date().getFullYear()),
    fuelCapacity: String(vehicle?.fuelCapacity ?? ""),
    odometer: String(vehicle?.odometer ?? "0"),
    status: vehicle ? (onDelivery ? "AVAILABLE" : vehicle.status) : "AVAILABLE",
    insuranceExpiry: toDateInput(vehicle?.insuranceExpiry),
    registrationExpiry: toDateInput(vehicle?.registrationExpiry),
    assignedDriverId: vehicle?.assignedDriverId ?? "",
    basePlace: "",
    lastLat: "",
    lastLng: "",
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={vehicle ? `Edit ${vehicle.registrationNumber}` : "Add vehicle"}
      description={vehicle ? "Update the vehicle record." : "Register a new vehicle in the fleet."}
      size="lg"
      fields={fields}
      schema={vehicleSchema}
      initial={initial}
      submitLabel={vehicle ? "Save changes" : "Add vehicle"}
      successMessage={vehicle ? "Vehicle updated" : "Vehicle added"}
      onFieldChange={(name, value, values) => {
        if (name !== "basePlace") return;
        const place = PLACES.find((p) => p.id === value);
        return { ...values, lastLat: place ? String(place.lat) : "", lastLng: place ? String(place.lng) : "" };
      }}
      onSubmit={(values) => (vehicle ? api.put(`/api/vehicles/${vehicle.id}`, values) : api.post("/api/vehicles", values))}
      onSuccess={onSaved}
    />
  );
}
