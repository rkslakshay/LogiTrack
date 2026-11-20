import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { AnalyticsView } from "./analytics-view";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requirePageUser("analytics:view");
  return <AnalyticsView />;
}
