import { route } from "@/lib/api";
import { resetDemoData } from "@/server/demo";

/** Rebuilds the sample dataset. Only available when DEMO_MODE is on. */
export const POST = route({ permission: "demo:reset" }, ({ user }) => resetDemoData(user));
