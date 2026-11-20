import { AppShell } from "@/components/app/shell";
import { requirePageUser } from "@/lib/auth-server";
import { demoStatus } from "@/server/demo";

// Everything under (app) requires a signed-in user. The check runs on the server
// for every request; individual pages add their own permission checks.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const demo = await demoStatus();
  return (
    <AppShell user={user} demo={{ enabled: demo.enabled, seededAt: demo.seededAt }}>
      {children}
    </AppShell>
  );
}
