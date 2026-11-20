import { parseRange, route } from "@/lib/api";
import { fuelIntelligence } from "@/server/services/intelligence";

const MIN_LOOKBACK_DAYS = 180;

/**
 * Mileage, cost per km, trends and data-quality flags per vehicle.
 * Judging mileage needs several fills, so the analysis always looks back at least
 * 180 days from the end of the requested range, however short that range is.
 */
export const GET = route({ permission: "fuel:read" }, ({ query }) => {
  const range = parseRange(query, MIN_LOOKBACK_DAYS);
  const earliest = new Date(range.to.getTime() - MIN_LOOKBACK_DAYS * 86_400_000);
  return fuelIntelligence({ from: range.from < earliest ? range.from : earliest, to: range.to });
});