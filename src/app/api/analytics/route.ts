import { parseRange, route } from "@/lib/api";
import { getAnalytics } from "@/server/services/analytics";

// ?compare=previous | year adds the comparison period, deltas and explanations.
export const GET = route({ permission: "analytics:view" }, ({ query }) => {
  const compare = query.get("compare");
  return getAnalytics(parseRange(query, 90), compare === "previous" || compare === "year" ? compare : "none");
});
