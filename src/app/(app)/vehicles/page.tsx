import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { VehiclesView } from "./vehicles-view";

export const metadata: Metadata = { title: "Vehicles" };

export default async function VehiclesPage() {
  await requirePageUser("vehicles:read");
  return <VehiclesView />;
}
