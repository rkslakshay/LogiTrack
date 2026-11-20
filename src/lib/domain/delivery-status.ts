import type { DeliveryStatus, Role } from "../constants";

/**
 * Delivery state machine.
 *
 *   PENDING -> ASSIGNED -> PICKED_UP -> IN_TRANSIT -> DELIVERED
 *
 * Side branches: any active state can become DELAYED or FAILED; a delivery can be
 * CANCELLED until it is in transit; ASSIGNED can go back to PENDING (unassign).
 * DELAYED resumes the main flow from wherever it was interrupted, which is
 * derived from whether the goods have been picked up.
 * DELIVERED, FAILED and CANCELLED are terminal.
 */
export function allowedTransitions(status: DeliveryStatus, ctx: { pickedUp: boolean }): DeliveryStatus[] {
  switch (status) {
    case "PENDING":
      return ["ASSIGNED", "CANCELLED"];
    case "ASSIGNED":
      return ["PICKED_UP", "DELAYED", "FAILED", "CANCELLED", "PENDING"];
    case "PICKED_UP":
      return ["IN_TRANSIT", "DELAYED", "FAILED", "CANCELLED"];
    case "IN_TRANSIT":
      return ["DELIVERED", "DELAYED", "FAILED"];
    case "DELAYED":
      return ctx.pickedUp ? ["IN_TRANSIT", "DELIVERED", "FAILED"] : ["PICKED_UP", "FAILED", "CANCELLED"];
    default:
      return [];
  }
}

export function canTransition(from: DeliveryStatus, to: DeliveryStatus, ctx: { pickedUp: boolean }): boolean {
  return allowedTransitions(from, ctx).includes(to);
}

/**
 * Transitions offered through the generic "update status" action.
 * ASSIGNED and PENDING are reached through assign/unassign (which need a driver
 * and vehicle), so they are excluded here. Drivers additionally cannot cancel.
 */
export function manualTransitions(status: DeliveryStatus, ctx: { pickedUp: boolean }, role: Role | string): DeliveryStatus[] {
  return allowedTransitions(status, ctx).filter((s) => {
    if (s === "ASSIGNED" || s === "PENDING") return false;
    if (role === "DRIVER" && s === "CANCELLED") return false;
    return true;
  });
}

export function isActive(status: string): boolean {
  return status === "ASSIGNED" || status === "PICKED_UP" || status === "IN_TRANSIT" || status === "DELAYED";
}

export function isTerminal(status: string): boolean {
  return status === "DELIVERED" || status === "FAILED" || status === "CANCELLED";
}
