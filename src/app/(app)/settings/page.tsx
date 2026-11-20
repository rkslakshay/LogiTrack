import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

// Every signed-in user has a profile; system settings are shown to Super Admins only.
export default async function SettingsPage() {
  await requirePageUser();
  return <SettingsView />;
}
