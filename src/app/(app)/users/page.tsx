import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth-server";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "User Management" };

export default async function UsersPage() {
  await requirePageUser("users:manage");
  return <UsersView />;
}
