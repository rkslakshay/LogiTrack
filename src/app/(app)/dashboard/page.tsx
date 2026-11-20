import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requirePageUser("dashboard:view");
  return <DashboardView />;
}
