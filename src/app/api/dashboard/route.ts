import { parseRange, route } from "@/lib/api";
import { getDashboard } from "@/server/services/analytics";

export const GET = route({ permission: "dashboard:view" }, ({ user, query }) => getDashboard(user, parseRange(query, 30)));
