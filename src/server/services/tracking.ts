import { prisma } from "@/lib/db";
import { parseGeometry } from "@/lib/routing";

/**
 * Snapshot of the fleet for the live map: every vehicle with a known position,
 * its driver and (when it has one) the delivery it is currently working on.
 * All positions come from the GPS simulator and are labelled as simulated in the UI.
 */
export async function fleetSnapshot() {
  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null, lastLat: { not: null }, lastLng: { not: null } },
    select: {
      id: true, code: true, registrationNumber: true, name: true, type: true, status: true, odometer: true,
      lastLat: true, lastLng: true, lastHeading: true, lastLocationAt: true,
      assignedDriver: { select: { id: true, fullName: true, phone: true } },
      deliveries: {
        where: { status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED"] } },
        select: {
          id: true, code: true, status: true, priority: true, customerName: true, pickupAddress: true, destinationAddress: true,
          pickupLat: true, pickupLng: true, destLat: true, destLng: true, expectedAt: true, pickedUpAt: true, progress: true,
          distanceKm: true, routeGeometry: true, geometrySource: true,
          driver: { select: { id: true, fullName: true, phone: true } },
        },
        orderBy: [{ pickedUpAt: { sort: "asc", nulls: "last" } }, { scheduledAt: "asc" }],
      },
    },
    orderBy: { registrationNumber: "asc" },
  });

  return vehicles.map(({ deliveries, assignedDriver, ...v }) => {
    // The delivery being driven right now takes precedence over ones still waiting.
    const moving = deliveries.find((d) => d.pickedUpAt && (d.status === "IN_TRANSIT" || d.status === "DELAYED"));
    const current = moving ?? deliveries[0] ?? null;
    return {
      ...v,
      lat: v.lastLat!,
      lng: v.lastLng!,
      heading: v.lastHeading ?? 0,
      driver: current?.driver ?? assignedDriver ?? null,
      activeDeliveryCount: deliveries.length,
      delivery: current
        ? {
            id: current.id, code: current.code, status: current.status, priority: current.priority, customerName: current.customerName,
            pickupAddress: current.pickupAddress, destinationAddress: current.destinationAddress,
            pickup: [current.pickupLat, current.pickupLng] as [number, number],
            destination: [current.destLat, current.destLng] as [number, number],
            expectedAt: current.expectedAt, progress: current.progress, distanceKm: current.distanceKm,
            moving: !!moving,
            geometry: parseGeometry(current.routeGeometry),
            geometrySource: current.geometrySource,
          }
        : null,
    };
  });
}

export type FleetVehicle = Awaited<ReturnType<typeof fleetSnapshot>>[number];
