"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fuel, Gauge, History, Package, Pencil, Route, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useQuery } from "@/lib/client";
import { FUEL_TYPE_LABELS, MAINTENANCE_TYPE_LABELS, VEHICLE_TYPE_LABELS, type FuelType, type MaintenanceType, type VehicleType } from "@/lib/constants";
import { formatDate, formatDateTime, formatINR, formatKm, formatNumber, timeAgo } from "@/lib/format";
import type { getVehicle } from "@/server/services/vehicles";
import { DataTable } from "@/components/app/data-table";
import { DetailList, ErrorState, LoadingState, PageHeader, StatCard } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { StatusBadge } from "@/components/app/status-badge";
import { VehicleFormDialog } from "@/components/forms/vehicle-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpiryCell } from "../vehicles-view";

type Vehicle = Awaited<ReturnType<typeof getVehicle>>;

export function VehicleDetail({ id }: { id: string }) {
  const can = useCan();
  const router = useRouter();
  const { data: v, loading, error, reload } = useQuery<Vehicle>(`/api/vehicles/${id}`);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = { href: "/vehicles", label: "Vehicles" };

  if (error) return <><PageHeader title="Vehicle" back={back} /><Card><ErrorState message={error} onRetry={reload} /></Card></>;
  if (loading || !v) return <><PageHeader title="Vehicle" back={back} /><LoadingState /></>;

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/vehicles/${id}`);
      toast.success(`${v.registrationNumber} removed from the fleet`);
      router.push("/vehicles");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setRemoving(false);
    }
  };

  const fuel = v.stats.fuel;
  return (
    <>
      <PageHeader
        back={back}
        title={<span className="flex flex-wrap items-center gap-2.5">{v.registrationNumber}<StatusBadge status={v.status} /></span>}
        description={`${v.name} · ${v.manufacturer} ${v.model} (${v.year}) · ${v.code}`}
        actions={
          can("vehicles:write") && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}><Pencil />Edit</Button>
              <Button variant="danger-ghost" onClick={() => setRemoving(true)}><Trash2 />Delete</Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Odometer" value={`${formatNumber(v.odometer)} km`} icon={Gauge} tone="neutral" />
        <StatCard label="Deliveries" value={v.stats.totalDeliveries} hint={`${v.stats.delivered} delivered · ${v.stats.failed} failed`} icon={Package} />
        <StatCard label="Average mileage" value={fuel.mileageKmPerL ? `${fuel.mileageKmPerL.toFixed(1)} km/L` : "—"} hint={fuel.costPerKmPaise ? `${formatINR(fuel.costPerKmPaise, true)} per km` : "Needs two fuel records"} icon={Fuel} tone="warning" />
        <StatCard label="Maintenance spend" value={formatINR(v.stats.maintenanceCostPaise)} hint="Completed jobs, all time" icon={Wrench} tone="violet" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Vehicle information" />
          <CardBody>
            <DetailList
              columns={3}
              items={[
                { label: "Vehicle ID", value: v.code },
                { label: "Registration number", value: v.registrationNumber },
                { label: "Vehicle name", value: v.name },
                { label: "Type", value: VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type },
                { label: "Manufacturer", value: v.manufacturer },
                { label: "Model", value: v.model },
                { label: "Manufacturing year", value: v.year },
                { label: "Fuel type", value: FUEL_TYPE_LABELS[v.fuelType as FuelType] ?? v.fuelType },
                { label: "Fuel capacity", value: `${v.fuelCapacity} ${v.fuelType === "ELECTRIC" ? "kWh" : "L"}` },
                { label: "Insurance expiry", value: <ExpiryCell date={v.insuranceExpiry} /> },
                { label: "Registration expiry", value: <ExpiryCell date={v.registrationExpiry} /> },
                { label: "Distance on deliveries", value: formatKm(v.stats.deliveredKm) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Assignment & location" />
          <CardBody>
            <DetailList
              columns={1}
              items={[
                {
                  label: "Assigned driver",
                  value: v.assignedDriver ? (
                    <Link href={`/drivers/${v.assignedDriver.id}`} className="text-primary hover:underline">
                      {v.assignedDriver.fullName} ({v.assignedDriver.code})
                    </Link>
                  ) : "Unassigned",
                },
                { label: "Driver phone", value: v.assignedDriver?.phone ?? "—" },
                {
                  label: "Last known location (simulated GPS)",
                  value: v.lastLat != null && v.lastLng != null ? `${v.lastLat.toFixed(5)}, ${v.lastLng.toFixed(5)}` : "Not available",
                },
                { label: "Last location update", value: v.lastLocationAt ? `${formatDateTime(v.lastLocationAt)} (${timeAgo(v.lastLocationAt)})` : "—" },
              ]}
            />
            {v.lastLat != null && (
              <Button asChild variant="secondary" size="sm" className="mt-4">
                <Link href={`/tracking?vehicle=${v.id}`}><Route />Show on live map</Link>
              </Button>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <Tabs defaultValue="deliveries">
          <TabsList className="px-3 pt-1">
            <TabsTrigger value="deliveries"><Package />Deliveries ({v.deliveries.length})</TabsTrigger>
            <TabsTrigger value="fuel"><Fuel />Fuel ({v.fuelRecords.length})</TabsTrigger>
            <TabsTrigger value="maintenance"><Wrench />Service history ({v.maintenance.length})</TabsTrigger>
            <TabsTrigger value="history"><History />Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="deliveries" className="pt-0">
            <DataTable
              rows={v.deliveries}
              rowKey={(d) => d.id}
              onRowClick={(d) => router.push(`/deliveries/${d.id}`)}
              empty={{ title: "No deliveries yet", description: "Deliveries assigned to this vehicle will appear here." }}
              columns={[
                { key: "code", header: "Delivery", render: (d) => <span className="font-medium text-primary">{d.code}</span> },
                { key: "customer", header: "Customer", render: (d) => d.customerName },
                { key: "dest", header: "Destination", hideBelow: "md", render: (d) => <span className="text-ink-2">{d.destinationAddress}</span> },
                { key: "driver", header: "Driver", hideBelow: "lg", render: (d) => d.driver?.fullName ?? "—" },
                { key: "date", header: "Scheduled", hideBelow: "sm", render: (d) => formatDate(d.scheduledAt) },
                { key: "km", header: "Distance", align: "right", hideBelow: "md", render: (d) => <span className="tabular">{formatKm(d.distanceKm)}</span> },
                { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
              ]}
            />
          </TabsContent>
          <TabsContent value="fuel" className="pt-0">
            <DataTable
              rows={v.fuelRecords}
              rowKey={(f) => f.id}
              empty={{ title: "No fuel records", description: "Fuel fills logged for this vehicle will appear here." }}
              columns={[
                { key: "date", header: "Date", render: (f) => formatDate(f.date) },
                { key: "station", header: "Station", hideBelow: "md", render: (f) => <span className="text-ink-2">{f.station}</span> },
                { key: "qty", header: "Quantity", align: "right", render: (f) => <span className="tabular">{f.quantityL} L</span> },
                { key: "price", header: "Price / L", align: "right", hideBelow: "sm", render: (f) => <span className="tabular">{formatINR(f.pricePerLitrePaise, true)}</span> },
                { key: "total", header: "Total", align: "right", render: (f) => <span className="tabular font-medium">{formatINR(f.totalCostPaise)}</span> },
                { key: "odo", header: "Odometer", align: "right", hideBelow: "sm", render: (f) => <span className="tabular">{formatNumber(f.odometer)} km</span> },
              ]}
            />
          </TabsContent>
          <TabsContent value="maintenance" className="pt-0">
            <DataTable
              rows={v.maintenance}
              rowKey={(m) => m.id}
              empty={{ title: "No service history", description: "Maintenance scheduled for this vehicle will appear here." }}
              columns={[
                { key: "date", header: "Service date", render: (m) => formatDate(m.serviceDate) },
                { key: "type", header: "Type", render: (m) => MAINTENANCE_TYPE_LABELS[m.type as MaintenanceType] ?? m.type },
                { key: "desc", header: "Description", hideBelow: "md", render: (m) => <span className="text-ink-2">{m.description}</span> },
                { key: "provider", header: "Provider", hideBelow: "lg", render: (m) => m.provider },
                { key: "cost", header: "Cost", align: "right", render: (m) => <span className="tabular">{formatINR(m.costPaise)}</span> },
                { key: "next", header: "Next service", hideBelow: "lg", render: (m) => formatDate(m.nextServiceDate) },
                { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
              ]}
            />
          </TabsContent>
          <TabsContent value="history" className="pt-0">
            <DataTable
              rows={v.history}
              rowKey={(h) => h.id}
              empty={{ title: "No activity recorded" }}
              columns={[
                { key: "when", header: "When", className: "whitespace-nowrap", render: (h) => formatDateTime(h.createdAt) },
                { key: "desc", header: "Activity", render: (h) => h.description },
                { key: "who", header: "By", hideBelow: "sm", render: (h) => h.user?.name ?? "System" },
              ]}
            />
          </TabsContent>
        </Tabs>
      </Card>

      <VehicleFormDialog open={editing} onOpenChange={setEditing} vehicle={v} onSaved={reload} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${v.registrationNumber}?`}
        description="The vehicle will be removed from the active fleet and unassigned from its driver. Its delivery, fuel and maintenance history is kept for reporting."
        confirmLabel="Remove vehicle"
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
