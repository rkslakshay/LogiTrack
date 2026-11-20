import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { MyDeliveriesView } from "./my-deliveries-view";

export const metadata: Metadata = { title: "My Deliveries" };

export default async function MyDeliveriesPage() {
  await requirePageUser("deliveries:own");
  return <MyDeliveriesView />;
}
