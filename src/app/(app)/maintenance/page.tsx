import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { MaintenanceView } from "./maintenance-view";

export const metadata: Metadata = { title: "Maintenance" };

export default async function MaintenancePage() {
  await requirePageUser("maintenance:read");
  return <MaintenanceView />;
}
