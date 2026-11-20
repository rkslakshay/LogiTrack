import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { RoutesView } from "./routes-view";

export const metadata: Metadata = { title: "Route Planning" };

export default async function RoutesPage() {
  await requirePageUser("routes:read");
  return <RoutesView />;
}
