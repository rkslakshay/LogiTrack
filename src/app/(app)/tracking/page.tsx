import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { TrackingView } from "./tracking-view";

export const metadata: Metadata = { title: "Live Tracking" };

export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  await requirePageUser("tracking:view");
  const { vehicle } = await searchParams;
  return <TrackingView initialVehicleId={vehicle ?? null} />;
}
