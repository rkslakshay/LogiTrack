import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { PerformanceView } from "./performance-view";

export const metadata: Metadata = { title: "Driver Performance" };

export default async function PerformancePage() {
  await requirePageUser("performance:view");
  return <PerformanceView />;
}
