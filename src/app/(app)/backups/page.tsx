import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { BackupsView } from "./backups-view";

export const metadata: Metadata = { title: "Backup & Restore" };

export default async function BackupsPage() {
  await requirePageUser("system:backup");
  return <BackupsView />;
}
