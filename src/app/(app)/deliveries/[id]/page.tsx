import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DeliveryDetail } from "./delivery-detail";

export const metadata: Metadata = { title: "Delivery details" };

// Drivers may open this page too; the API only returns their own deliveries.
export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser(["deliveries:read", "deliveries:own"]);
  const { id } = await params;
  return <DeliveryDetail id={id} />;
}
