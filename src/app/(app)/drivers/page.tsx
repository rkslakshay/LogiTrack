import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { DriversView } from "./drivers-view";

export const metadata: Metadata = { title: "Drivers" };

export default async function DriversPage() {
  await requirePageUser("drivers:read");
  return <DriversView />;
}
