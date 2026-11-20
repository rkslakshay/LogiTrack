"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, errorMessage, qs, useListState, useQuery, type Paged } from "@/lib/client";
import { ROLE_LABELS, humanize, type Role } from "@/lib/constants";
import { formatDateTime, toDateInput } from "@/lib/format";
import { DataTable, DateRangeFilter, FilterSelect, Pagination, SearchInput, Toolbar, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page";
import { useCan } from "@/components/app/providers";
import { Badge, type Tone } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string;
  createdAt: string;
  user: { id: string; name: string; role: string } | null;
}
interface Response extends Paged<ActivityRow> {
  facets: { entityTypes: string[]; users: { id: string; name: string }[] };
}

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "ASSIGN", "UNASSIGN", "STATUS_CHANGE", "COMPLETE", "LOGIN", "LOGOUT", "EXPORT", "SYSTEM"];
const ACTION_TONE: Record<string, Tone> = {
  CREATE: "success", UPDATE: "info", DELETE: "danger", ASSIGN: "indigo", UNASSIGN: "neutral", STATUS_CHANGE: "warning", COMPLETE: "success",
  LOGIN: "muted", LOGOUT: "muted", EXPORT: "neutral", SYSTEM: "neutral",
};
/** "MaintenanceRecord" -> "Maintenance Record" */
const entityLabel = (t: string) => t.replace(/([a-z])([A-Z])/g, "$1 $2");

export function ActivityView() {
  const can = useCan();
  const list = useListState({ pageSize: 20, filters: { entityType: "", action: "", userId: "", from: "", to: "" } });
  const { data, loading, refreshing, error, reload } = useQuery<Response>(`/api/activity${list.query}`);

  const exportCsv = async () => {
    try {
      const file = await downloadFile(`/api/reports/activity${qs({ from: list.filters.from || toDateInput(new Date(Date.now() - 30 * 86_400_000)), to: list.filters.to || toDateInput(new Date()) })}`);
      toast.success(`Downloaded ${file}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const columns: Column<ActivityRow>[] = [
    { key: "when", header: "Timestamp", sortKey: "createdAt", className: "whitespace-nowrap", render: (a) => formatDateTime(a.createdAt) },
    {
      key: "user", header: "User",
      render: (a) => (a.user ? <div><p className="whitespace-nowrap">{a.user.name}</p><p className="text-xs text-ink-3">{ROLE_LABELS[a.user.role as Role] ?? a.user.role}</p></div> : <span className="text-ink-3">System</span>),
    },
    { key: "action", header: "Action", sortKey: "action", render: (a) => <Badge tone={ACTION_TONE[a.action] ?? "neutral"}>{humanize(a.action)}</Badge> },
    { key: "entity", header: "Entity", sortKey: "entityType", hideBelow: "sm", render: (a) => entityLabel(a.entityType) },
    { key: "description", header: "Description", render: (a) => <span className="text-ink-2">{a.description}</span> },
    { key: "id", header: "Entity ID", hideBelow: "xl", render: (a) => <span className="font-mono text-xs text-ink-3">{a.entityId ? a.entityId.slice(-8) : "—"}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Activity Logs"
        description="Audit trail of every important change: who did what, to which record, and when."
        actions={can("reports:export") && <Button variant="secondary" onClick={exportCsv}><Download />Export CSV</Button>}
      />
      <Card>
        <Toolbar list={list}>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search description or user…" />
          <FilterSelect label="Entities" value={list.filters.entityType} onChange={(v) => list.setFilter("entityType", v)} options={(data?.facets.entityTypes ?? []).map((t) => ({ value: t, label: entityLabel(t) }))} />
          <FilterSelect label="Actions" value={list.filters.action} onChange={(v) => list.setFilter("action", v)} options={ACTIONS.map((a) => ({ value: a, label: humanize(a) }))} />
          <FilterSelect label="Users" value={list.filters.userId} onChange={(v) => list.setFilter("userId", v)} options={(data?.facets.users ?? []).map((u) => ({ value: u.id, label: u.name }))} />
          <DateRangeFilter from={list.filters.from} to={list.filters.to} onChange={(from, to) => { list.setFilter("from", from); list.setFilter("to", to); }} />
        </Toolbar>
        <DataTable
          caption="Activity log"
          columns={columns}
          rows={data?.items}
          rowKey={(a) => a.id}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRetry={reload}
          sort={list.sort}
          dir={list.dir}
          onSort={list.toggleSort}
          empty={{ title: "No activity matches your filters", description: "Try a wider date range or clear the filters." }}
        />
        {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} noun="entries" />}
      </Card>
    </>
  );
}
