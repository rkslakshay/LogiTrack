import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DeliveriesView } from "./deliveries-view";

export const metadata: Metadata = { title: "Deliveries" };

export default async function DeliveriesPage() {
  await requirePageUser("deliveries:read");
  return <DeliveriesView />;
}
