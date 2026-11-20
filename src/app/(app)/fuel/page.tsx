import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { FuelView } from "./fuel-view";

export const metadata: Metadata = { title: "Fuel Management" };

export default async function FuelPage() {
  await requirePageUser("fuel:read");
  return <FuelView />;
}
