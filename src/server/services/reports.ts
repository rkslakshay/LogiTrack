import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { FUEL_TYPE_LABELS, MAINTENANCE_TYPE_LABELS, VEHICLE_TYPE_LABELS, humanize, type FuelType, type MaintenanceType, type VehicleType } from "@/lib/constants";
import type { CsvValue } from "@/lib/csv";
import { badRequest } from "@/lib/errors";
import { computeFuelStats } from "@/lib/domain/fuel";
import { getAnalytics } from "./analytics";
import { leaderboard } from "./performance";

export const REPORT_TYPES = ["deliveries", "vehicles", "drivers", "fuel", "fuel-efficiency", "maintenance", "activity", "analytics"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface Report {
  type: ReportType;
  title: string;
  filename: string;
  headers: string[];
  rows: CsvValue[][];
}

const dt = (d: Date | null | undefined) => (d ? format(d, "yyyy-MM-dd HH:mm") : "");
const day = (d: Date | null | undefined) => (d ? format(d, "yyyy-MM-dd") : "");
const rupees = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2));
const percent = (fraction: number | null) => (fraction == null ? "" : (fraction * 100).toFixed(1));

/** Builds a report from live database queries. Every figure is derived, nothing is stored. */
export async function buildReport(type: string, range: { from: Date; to: Date }): Promise<Report> {
  const inRange = { gte: range.from, lte: range.to };
  const stamp = `${day(range.from)}_to_${day(range.to)}`;
  const base = (title: string) => ({ type: type as ReportType, title, filename: `logitrack-${type}-${stamp}.csv` });

  switch (type) {
    case "deliveries": {
      const rows = await prisma.delivery.findMany({
        where: { scheduledAt: inRange },
        include: { driver: { select: { fullName: true } }, vehicle: { select: { registrationNumber: true } } },
        orderBy: { scheduledAt: "asc" },
      });
      return {
        ...base("Deliveries"),
        headers: [
          "Delivery ID", "Status", "Priority", "Customer", "Customer Phone", "Pickup", "Destination", "Driver", "Vehicle",
          "Scheduled", "Expected", "Picked Up", "Delivered", "Distance (km)", "On Time",
        ],
        rows: rows.map((d) => [
          d.code, humanize(d.status), humanize(d.priority), d.customerName, d.customerPhone, d.pickupAddress, d.destinationAddress,
          d.driver?.fullName ?? "", d.vehicle?.registrationNumber ?? "", dt(d.scheduledAt), dt(d.expectedAt), dt(d.pickedUpAt), dt(d.deliveredAt),
          d.distanceKm, d.status === "DELIVERED" ? (d.deliveredAt! <= d.expectedAt ? "Yes" : "No") : "",
        ]),
      };
    }
    case "vehicles": {
      const [analytics, vehicles] = await Promise.all([
        getAnalytics(range),
        prisma.vehicle.findMany({ where: { deletedAt: null }, include: { assignedDriver: { select: { fullName: true } } } }),
      ]);
      return {
        ...base("Vehicle performance"),
        headers: [
          "Vehicle ID", "Registration", "Name", "Type", "Fuel", "Status", "Assigned Driver", "Odometer (km)", "Deliveries", "Delivered",
          "Distance (km)", "Fuel Cost (INR)", "Maintenance Cost (INR)", "Utilization (%)", "Insurance Expiry", "Registration Expiry",
        ],
        rows: analytics.vehicles.map((row) => {
          const v = vehicles.find((x) => x.id === row.id)!;
          return [
            v.code, v.registrationNumber, v.name, VEHICLE_TYPE_LABELS[v.type as VehicleType] ?? v.type, FUEL_TYPE_LABELS[v.fuelType as FuelType] ?? v.fuelType,
            humanize(v.status), v.assignedDriver?.fullName ?? "", v.odometer, row.deliveries, row.delivered, row.distanceKm,
            rupees(row.fuelCostPaise), rupees(row.maintenanceCostPaise), row.utilization, day(v.insuranceExpiry), day(v.registrationExpiry),
          ];
        }),
      };
    }
    case "drivers": {
      const board = await leaderboard(range.from, range.to);
      return {
        ...base("Driver performance"),
        headers: [
          "Rank", "Driver ID", "Name", "Status", "Vehicle", "Total Deliveries", "Delivered", "Failed", "Cancelled", "On Time", "Late",
          "Success Rate (%)", "On-Time Rate (%)", "Distance (km)", "Avg Duration (min)", "Score",
        ],
        rows: board.rows.map((r) => [
          r.rank ?? "Not rated", r.driver.code, r.driver.fullName, humanize(r.driver.status), r.driver.vehicle?.registrationNumber ?? "",
          r.stats.total, r.stats.delivered, r.stats.failed, r.stats.cancelled, r.stats.onTime, r.stats.late,
          percent(r.stats.successRate), percent(r.stats.onTimeRate), r.stats.distanceKm,
          r.stats.avgDurationMin == null ? "" : Math.round(r.stats.avgDurationMin), r.stats.score ?? "",
        ]),
      };
    }
    case "fuel": {
      const rows = await prisma.fuelRecord.findMany({
        where: { date: inRange },
        include: { vehicle: { select: { registrationNumber: true, name: true } } },
        orderBy: { date: "asc" },
      });
      return {
        ...base("Fuel records"),
        headers: ["Record ID", "Date", "Vehicle", "Vehicle Name", "Quantity (L)", "Price per Litre (INR)", "Total Cost (INR)", "Odometer (km)", "Station", "Notes"],
        rows: rows.map((f) => [
          f.code, day(f.date), f.vehicle.registrationNumber, f.vehicle.name, f.quantityL, rupees(f.pricePerLitrePaise), rupees(f.totalCostPaise),
          f.odometer, f.station, f.notes ?? "",
        ]),
      };
    }
    case "fuel-efficiency": {
      const records = await prisma.fuelRecord.findMany({
        where: { date: inRange },
        include: { vehicle: { select: { registrationNumber: true, name: true } } },
      });
      const groups = new Map<string, typeof records>();
      for (const r of records) groups.set(r.vehicleId, [...(groups.get(r.vehicleId) ?? []), r]);
      return {
        ...base("Fuel efficiency by vehicle"),
        headers: ["Vehicle", "Vehicle Name", "Fills", "Total Litres", "Total Cost (INR)", "Distance (km)", "Mileage (km/L)", "Cost per km (INR)"],
        rows: [...groups.values()].map((rows) => {
          const s = computeFuelStats(rows);
          return [
            rows[0].vehicle.registrationNumber, rows[0].vehicle.name, s.fillCount, s.totalLitres.toFixed(1), rupees(s.totalCostPaise), s.distanceKm,
            s.mileageKmPerL == null ? "" : s.mileageKmPerL.toFixed(2), s.costPerKmPaise == null ? "" : (s.costPerKmPaise / 100).toFixed(2),
          ];
        }),
      };
    }
    case "maintenance": {
      const rows = await prisma.maintenanceRecord.findMany({
        where: { serviceDate: inRange },
        include: { vehicle: { select: { registrationNumber: true, name: true } } },
        orderBy: { serviceDate: "asc" },
      });
      return {
        ...base("Maintenance records"),
        headers: ["Record ID", "Vehicle", "Vehicle Name", "Type", "Status", "Service Date", "Completed", "Odometer (km)", "Cost (INR)", "Provider", "Next Service Date", "Next Service Odometer", "Description"],
        rows: rows.map((m) => [
          m.code, m.vehicle.registrationNumber, m.vehicle.name, MAINTENANCE_TYPE_LABELS[m.type as MaintenanceType] ?? m.type, humanize(m.status),
          day(m.serviceDate), day(m.completedAt), m.odometer ?? "", rupees(m.costPaise), m.provider, day(m.nextServiceDate), m.nextServiceOdometer ?? "", m.description,
        ]),
      };
    }
    case "activity": {
      const rows = await prisma.activityLog.findMany({
        where: { createdAt: inRange },
        include: { user: { select: { name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      });
      return {
        ...base("Activity log"),
        headers: ["Timestamp", "User", "Role", "Action", "Entity", "Entity ID", "Description"],
        rows: rows.map((a) => [dt(a.createdAt), a.user?.name ?? "System", a.user ? humanize(a.user.role) : "", humanize(a.action), a.entityType, a.entityId ?? "", a.description]),
      };
    }
    case "analytics": {
      const a = await getAnalytics(range);
      const sum = a.summary;
      return {
        ...base("Analytics summary and trend"),
        headers: ["Period", "Deliveries", "Delivered", "On Time", "Late", "Failed", "Cancelled", "Fuel Cost (INR)", "Maintenance Cost (INR)"],
        rows: [
          ...a.timeline.map((t) => [t.label, t.total, t.delivered, t.onTime, t.late, t.failed, t.cancelled, rupees(t.fuelCost), rupees(t.maintenanceCost)]),
          ["Total", sum.totalDeliveries, sum.delivered, "", "", sum.failed, sum.cancelled, rupees(sum.fuelCostPaise), rupees(sum.maintenanceCostPaise)],
          [],
          ["Success rate (%)", percent(sum.successRate)],
          ["On-time rate (%)", percent(sum.onTimeRate)],
          ["Fleet utilisation (%)", percent(sum.fleetUtilization)],
          ["Distance delivered (km)", sum.distanceKm],
          ["Cost per delivery (INR)", rupees(sum.costPerDeliveryPaise)],
        ],
      };
    }
    default:
      throw badRequest(`Unknown report type "${type}".`);
  }
}
