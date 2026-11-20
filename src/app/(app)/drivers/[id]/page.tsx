import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DriverDetail } from "./driver-detail";

export const metadata: Metadata = { title: "Driver profile" };

export default async function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser("drivers:read");
  const { id } = await params;
  return <DriverDetail id={id} />;
}
