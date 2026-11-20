"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronDown, Compass, LogOut, Menu as MenuIcon, Truck, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/lib/auth";
import { api, errorMessage, markSigningOut, useQuery } from "@/lib/client";
import { ROLE_LABELS } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { canAny } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { NAV } from "./nav";
import { DemoBanner } from "./demo-banner";
import { AppProviders, useRealtime, useSocketEvent, useUser, type DemoInfo } from "./providers";
import { TourCard, TourPrompt, TourProvider, useTour } from "./tour";
import { Badge, toneFor } from "./status-badge";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-white">
        <Truck className="size-[18px]" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-white">LogiTrack</span>
        <span className="block text-[11px] text-navy-300">Fleet &amp; Logistics</span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const pathname = usePathname();
  const tour = useTour();
  const groups = NAV.map((group) => ({ ...group, items: group.items.filter((item) => canAny(user.role, item.permissions)) })).filter(
    (group) => group.items.length > 0,
  );
  return (
    <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-4">
      {groups.map((group) => (
        <div key={group.label} className="mt-4 first:mt-1">
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-300/80">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              // The tour points at the module it is currently describing.
              const spotlight = tour.active && tour.step?.href === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors",
                      active ? "bg-primary text-white" : "text-navy-200 hover:bg-navy-800 hover:text-white",
                      spotlight && "ring-2 ring-white/70 ring-offset-2 ring-offset-navy-900",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { connected } = useRealtime();
  return (
    <div className="border-t border-navy-800 px-4 py-3 text-[11px] text-navy-300">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
        {connected ? "Live updates connected" : "Connecting to live updates…"}
      </span>
    </div>
  );
}

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  isRead: boolean;
  createdAt: string;
}

function NotificationBell() {
  const router = useRouter();
  const count = useQuery<{ unread: number }>("/api/notifications/count");
  const [open, setOpen] = React.useState(false);
  const latest = useQuery<{ items: NotificationRow[] }>(open ? "/api/notifications?pageSize=6" : null);

  useSocketEvent<{ title: string; message: string; severity: string }>("notification:new", (n) => {
    count.reload();
    if (open) latest.reload();
    const show = n.severity === "CRITICAL" ? toast.error : n.severity === "WARNING" ? toast.warning : n.severity === "SUCCESS" ? toast.success : toast.info;
    show(n.title, { description: n.message });
  });

  // The notifications page announces read/dismiss actions so the badge stays in sync.
  const reloadCount = count.reload;
  React.useEffect(() => {
    window.addEventListener("logitrack:notifications-changed", reloadCount);
    return () => window.removeEventListener("logitrack:notifications-changed", reloadCount);
  }, [reloadCount]);

  const markAll = async () => {
    try {
      await api.post("/api/notifications/read-all");
      count.reload();
      latest.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const unread = count.data?.unread ?? 0;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <button
          type="button"
          className="relative grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft hover:text-ink"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="tabular absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">Notifications</p>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <CheckCheck className="size-3.5" />
              Mark all as read
            </button>
          )}
        </div>
        <div className="scroll-thin max-h-80 overflow-y-auto">
          {latest.loading && <p className="px-3 py-6 text-center text-xs text-ink-3">Loading…</p>}
          {latest.data?.items.length === 0 && <p className="px-3 py-6 text-center text-xs text-ink-3">You have no notifications.</p>}
          {latest.data?.items.map((n) => (
            <div key={n.id} className={cn("border-b border-line px-3 py-2 last:border-0", !n.isRead && "bg-primary-soft/40")}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink">{n.title}</p>
                <Badge tone={toneFor(n.severity)}>{n.category.charAt(0) + n.category.slice(1).toLowerCase()}</Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{n.message}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">{timeAgo(n.createdAt)}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
          className="w-full border-t border-line px-3 py-2 text-center text-xs font-medium text-primary hover:bg-canvas"
        >
          View all notifications
        </button>
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const user = useUser();
  const router = useRouter();
  const tour = useTour();
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const logout = async () => {
    markSigningOut();
    try {
      await api.post("/api/auth/logout");
    } finally {
      // Full navigation so every cached page and the socket are dropped.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        {/* The accessible name includes the visible name and role (WCAG 2.5.3 label in name). */}
        <button type="button" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 hover:bg-neutral-soft">
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-navy-900 text-xs font-semibold text-white">{initials}</span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-36 truncate text-[13px] font-medium text-ink">{user.name}</span>
            <span className="block text-[11px] text-ink-3">{ROLE_LABELS[user.role]}</span>
          </span>
          <span className="sr-only">Account menu</span>
          <ChevronDown aria-hidden className="hidden size-3.5 text-ink-3 sm:block" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{user.email}</MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => router.push("/settings")}>
          <UserRound />
          Profile &amp; settings
        </MenuItem>
        {tour.count > 0 && (
          <MenuItem onSelect={tour.start}>
            <Compass />
            Product tour
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem tone="danger" onSelect={logout}>
          <LogOut />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-navy-900 lg:flex">
        <Brand />
        <SidebarNav />
        <TourPrompt />
        <SidebarFooter />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onKeyDown={(e) => e.key === "Escape" && setMobileOpen(false)}>
          <div className="absolute inset-0 animate-fade-in bg-navy-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-64 animate-slide-in flex-col bg-navy-900" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" autoFocus onClick={() => setMobileOpen(false)} className="absolute right-2 top-3 rounded-md p-1.5 text-navy-200 hover:bg-navy-800" aria-label="Close menu">
              <X className="size-4" />
            </button>
            <Brand />
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <SidebarFooter />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft lg:hidden" aria-label="Open menu">
              <MenuIcon className="size-5" />
            </button>
            <span className="text-sm font-semibold text-ink lg:hidden">LogiTrack</span>
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-5 outline-none sm:px-5">
          {children}
        </main>
      </div>
      <TourCard />
    </div>
  );
}

export function AppShell({ user, demo, children }: { user: SessionUser; demo: DemoInfo; children: React.ReactNode }) {
  return (
    <AppProviders user={user} demo={demo}>
      <TourProvider>
        <Shell>{children}</Shell>
      </TourProvider>
    </AppProviders>
  );
}
