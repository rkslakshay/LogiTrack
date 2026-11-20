"use client";

import { api, useQuery } from "@/lib/client";
import { humanize } from "@/lib/constants";
import { toDateInput } from "@/lib/format";
import { driverSchema } from "@/lib/validation";
import { FormDialog, type FieldConfig, type FormValues } from "@/components/app/form-dialog";

export interface DriverRecord {
  id: string;
  code: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  licenseNumber: string;
  licenseExpiry: string | Date;
  joiningDate: string | Date;
  status: string;
  hasLogin: boolean;
  vehicle: { id: string; registrationNumber: string; name: string } | null;
}

interface VehicleOption {
  id: string;
  registrationNumber: string;
  name: string;
  status: string;
  assignedDriverId: string | null;
}

export function DriverFormDialog({
  open, onOpenChange, driver, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driver?: DriverRecord | null;
  onSaved: () => void;
}) {
  const vehicles = useQuery<VehicleOption[]>(open ? "/api/vehicles/options" : null);
  const onDelivery = driver?.status === "ON_DELIVERY";

  const fields: FieldConfig[] = [
    { name: "fullName", label: "Full name", required: true, placeholder: "Ramesh Patil" },
    { name: "email", label: "Email", type: "email", required: true, placeholder: "ramesh.patil@logitrack.in" },
    { name: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+91 98765 43210" },
    { name: "licenseNumber", label: "Driving licence number", required: true, placeholder: "MH12 2019 0045678", hint: "State code, RTO, year and 7-digit number" },
    { name: "licenseExpiry", label: "Licence expiry", type: "date", required: true },
    { name: "joiningDate", label: "Joining date", type: "date", required: true },
    { name: "address", label: "Address", required: true, wide: true, placeholder: "Street, area, city and PIN code" },
    {
      name: "status", label: "Status", type: "select", required: true, emptyOption: null, disabled: onDelivery,
      hint: onDelivery ? "On a delivery: status is managed by the delivery workflow" : undefined,
      options: ["AVAILABLE", "OFF_DUTY", "INACTIVE"].map((s) => ({ value: s, label: humanize(s) })),
    },
    {
      name: "assignedVehicleId", label: "Assigned vehicle", type: "select", emptyOption: "No vehicle",
      options: (vehicles.data ?? [])
        .filter((v) => v.status !== "INACTIVE" || v.id === driver?.vehicle?.id)
        .map((v) => ({
          value: v.id,
          label: `${v.registrationNumber} · ${v.name}${v.assignedDriverId && v.id !== driver?.vehicle?.id ? " — has a driver" : ""}`,
          // A vehicle that already has another driver must be released first.
          disabled: !!v.assignedDriverId && v.id !== driver?.vehicle?.id,
        })),
    },
    {
      name: "loginPassword", label: driver?.hasLogin ? "Reset login password" : "Login password", type: "password", wide: true, autoComplete: "new-password",
      section: "Driver app access",
      hint: driver?.hasLogin
        ? "This driver can sign in with their email. Leave blank to keep the current password."
        : "Optional. Set a password to let this driver sign in with their email (min. 8 characters, letters and numbers).",
    },
  ];

  const initial: FormValues = {
    fullName: driver?.fullName ?? "",
    email: driver?.email ?? "",
    phone: driver?.phone ?? "",
    address: driver?.address ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    licenseExpiry: toDateInput(driver?.licenseExpiry),
    joiningDate: toDateInput(driver?.joiningDate ?? new Date()),
    status: driver ? (onDelivery ? "AVAILABLE" : driver.status) : "AVAILABLE",
    assignedVehicleId: driver?.vehicle?.id ?? "",
    loginPassword: "",
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={driver ? `Edit ${driver.fullName}` : "Add driver"}
      description={driver ? "Update the driver profile." : "Create a driver profile and, optionally, a login account."}
      size="lg"
      fields={fields}
      schema={driverSchema}
      initial={initial}
      submitLabel={driver ? "Save changes" : "Add driver"}
      successMessage={driver ? "Driver updated" : "Driver added"}
      onSubmit={(values) => (driver ? api.put(`/api/drivers/${driver.id}`, values) : api.post("/api/drivers", values))}
      onSuccess={onSaved}
    />
  );
}
