"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, MailOpen, Mail, OctagonAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, useListState, useQuery, type Paged } from "@/lib/client";
import { NOTIFICATION_CATEGORIES, humanize } from "@/lib/constants";
import { formatDateTime, timeAgo } from "@/lib/format";
import { can as canRole } from "@/lib/permissions";
import { FilterSelect, Pagination, SearchInput, Toolbar } from "@/components/app/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { useSocketEvent, useUser } from "@/components/app/providers";
import { Badge, toneFor } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface NotificationRow {
  id: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

const ICONS = { INFO: Info, SUCCESS: CheckCircle2, WARNING: AlertTriangle, CRITICAL: OctagonAlert } as const;
const ICON_TONE = { INFO: "bg-info-soft text-info", SUCCESS: "bg-success-soft text-success", WARNING: "bg-warning-soft text-warning", CRITICAL: "bg-danger-soft text-danger" } as const;

export function NotificationsView() {
  const user = useUser();
  const list = useListState({ pageSize: 20, filters: { category: "", unread: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Paged<NotificationRow> & { unread: number }>(`/api/notifications${list.query}`);
  const [busy, setBusy] = useState(false);

  useSocketEvent("notification:new", reload);

  /** Deep link to the record a notification is about, when this role can open it. */
  const linkFor = (n: NotificationRow): string | null => {
    if (!n.entityId) return null;
    if (n.entityType === "Delivery") return `/deliveries/${n.entityId}`;
    if (n.entityType === "Vehicle" && canRole(user.role, "vehicles:read")) return `/vehicles/${n.entityId}`;
    if (n.entityType === "Driver" && canRole(user.role, "drivers:read")) return `/drivers/${n.entityId}`;
    if (n.entityType === "MaintenanceRecord" && canRole(user.role, "maintenance:read")) return "/maintenance";
    return null;
  };

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      reload();
      // The bell in the top bar listens for this to refresh its count.
      window.dispatchEvent(new Event("logitrack:notifications-changed"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} unread` : "Operational alerts and reminders"}
        actions={
          <Button variant="secondary" disabled={!data?.unread || busy} onClick={() => run(() => api.post("/api/notifications/read-all"), "All notifications marked as read")}>
            <CheckCheck />
            Mark all as read
          </Button>
        }
      />
      <Card>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search notifications…" />
          <FilterSelect label="Categories" value={list.filters.category} onChange={(v) => list.setFilter("category", v)} options={NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
          <FilterSelect label="Read state" allLabel="Read and unread" value={list.filters.unread} onChange={(v) => list.setFilter("unread", v)} options={[{ value: "true", label: "Unread only" }]} />
        </Toolbar>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <LoadingState />
        ) : data?.items.length === 0 ? (
          <EmptyState icon={Bell} title={list.activeFilterCount ? "No notifications match your filters" : "You're all caught up"} description="New assignments, delays, maintenance and expiry reminders will appear here." />
        ) : (
          <ul className={`divide-y divide-line ${refreshing ? "opacity-60" : ""}`}>
            {data?.items.map((n) => {
              const Icon = ICONS[n.severity as keyof typeof ICONS] ?? Info;
              const href = linkFor(n);
              return (
                <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.isRead ? "" : "bg-primary-soft/40"}`}>
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full ${ICON_TONE[n.severity as keyof typeof ICON_TONE] ?? ICON_TONE.INFO}`}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className={`text-[13px] text-ink ${n.isRead ? "font-medium" : "font-semibold"}`}>{n.title}</p>
                      <Badge tone={toneFor(n.severity)}>{humanize(n.category)}</Badge>
                      {!n.isRead && <span className="size-2 rounded-full bg-primary" role="img" aria-label="Unread" />}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-2">{n.message}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                      <span title={formatDateTime(n.createdAt)}>{timeAgo(n.createdAt)} · {formatDateTime(n.createdAt)}</span>
                      {href && <Link href={href} className="font-medium text-primary hover:underline">Open record</Link>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title={n.isRead ? "Mark as unread" : "Mark as read"}
                      aria-label={n.isRead ? `Mark "${n.title}" as unread` : `Mark "${n.title}" as read`}
                      onClick={() => run(() => api.patch(`/api/notifications/${n.id}`, { isRead: !n.isRead }))}
                    >
                      {n.isRead ? <Mail /> : <MailOpen />}
                    </Button>
                    <Button variant="ghost" size="icon" disabled={busy} title="Dismiss" aria-label={`Dismiss "${n.title}"`} onClick={() => run(() => api.del(`/api/notifications/${n.id}`), "Notification dismissed")}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} noun="notifications" />}
      </Card>
    </>
  );
}
