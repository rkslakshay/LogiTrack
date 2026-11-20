import type { Metadata } from "next";
import { DriverPerformance } from "@/components/app/driver-performance";
import { requirePageUser } from "@/lib/auth-server";

export const metadata: Metadata = { title: "My Performance" };

export default async function MyPerformancePage() {
  await requirePageUser("performance:own");
  // "me" is resolved to the signed-in driver's profile by the API.
  return <DriverPerformance driverId="me" own />;
}
