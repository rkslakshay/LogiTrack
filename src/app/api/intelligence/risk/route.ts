import { route } from "@/lib/api";
import { riskOverview } from "@/server/services/intelligence";

/** Rule-based delay risk for every open delivery, riskiest first. */
export const GET = route({ permission: "deliveries:read" }, () => riskOverview());
