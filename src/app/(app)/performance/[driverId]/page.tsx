import type { Metadata } from "next";
import { DriverPerformance } from "@/components/app/driver-performance";
import { requirePageUser } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Driver performance" };

export default async function DriverPerformancePage({ params }: { params: Promise<{ driverId: string }> }) {
  await requirePageUser("performance:view");
  const { driverId } = await params;
  return <DriverPerformance driverId={driverId} />;
}
