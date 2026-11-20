import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DiagnosticsView } from "./diagnostics-view";

export const metadata: Metadata = { title: "Diagnostics" };

export default async function DiagnosticsPage() {
  await requirePageUser("system:diagnostics");
  return <DiagnosticsView />;
}
