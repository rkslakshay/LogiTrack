import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { NotificationsView } from "./notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePageUser("notifications:read");
  return <NotificationsView />;
}
