import { parseRange, route } from "@/lib/api";
import { leaderboard } from "@/server/services/performance";

export const GET = route({ permission: "performance:view" }, ({ query }) => {
  const range = parseRange(query, 180);
  return leaderboard(range.from, range.to);
});
