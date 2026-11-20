import { parseRange, route } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { driverPerformance } from "@/server/services/performance";

// "me" resolves to the signed-in driver's own profile.
export const GET = route({ permission: ["performance:view", "performance:own"] }, async ({ user, params, query }) => {
  const driverId = params.driverId === "me" ? user.driverId : params.driverId;
  if (!driverId) throw forbidden("Your account is not linked to a driver profile.");
  const range = parseRange(query, 180);
  return driverPerformance(user, driverId, range.from, range.to);
});
