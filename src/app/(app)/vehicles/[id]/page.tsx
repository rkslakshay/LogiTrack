import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { VehicleDetail } from "./vehicle-detail";

export const metadata: Metadata = { title: "Vehicle details" };

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser("vehicles:read");
  const { id } = await params;
  return <VehicleDetail id={id} />;
}
