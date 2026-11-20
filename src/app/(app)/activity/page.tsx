import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { ActivityView } from "./activity-view";

export const metadata: Metadata = { title: "Activity Logs" };

export default async function ActivityPage() {
  await requirePageUser("activity:read");
  return <ActivityView />;
}
