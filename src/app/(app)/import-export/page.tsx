import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { ImportExportView } from "./import-export-view";

export const metadata: Metadata = { title: "Import & Export" };

export default async function ImportExportPage() {
  // Any staff role that can read at least one data type; the page lists only what the role may use.
  await requirePageUser(["vehicles:read", "drivers:read", "deliveries:read", "fuel:read", "maintenance:read"]);
  return <ImportExportView />;
}
