import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requirePageUser("reports:export");
  return <ReportsView />;
}
