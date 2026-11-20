"use client";

import * as React from "react";
import { CheckCircle2, DatabaseBackup, Download, RotateCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile, errorMessage, useQuery } from "@/lib/client";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page";
import { ReauthDialog } from "@/components/app/reauth-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Badge, type Tone } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

interface BackupRow {
  file: string;
  createdAt: string;
  reason: string;
  sizeBytes: number;
  createdBy: { id: string; name: string } | null;
  verified: boolean | null;
  verifiedAt: string | null;
  latestMigration: string | null;
  counts: Record<string, number> | null;
  sha256: string | null;
}
interface BackupList {
  directory: string;
  scheduledEveryHours: number;
  keepScheduled: number;
  backups: BackupRow[];
}
interface Integrity {
  ok: boolean;
  integrity: string;
  foreignKeyViolations: number;
  migrations: string[];
  durationMs: number;
  sizeBytes: number;
  walBytes: number;
  journalMode: string;
}

const REASON: Record<string, { label: string; tone: Tone }> = {
  manual: { label: "Manual", tone: "info" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  "pre-restore": { label: "Before restore", tone: "warning" },
  "pre-migrate": { label: "Before upgrade", tone: "warning" },
  cli: { label: "Command line", tone: "indigo" },
  imported: { label: "Imported", tone: "muted" },
};

const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const COUNT_LABELS: [string, string, string][] = [
  ["Vehicle", "vehicle", "vehicles"],
  ["Driver", "driver", "drivers"],
  ["Delivery", "delivery", "deliveries"],
  ["User", "user", "users"],
];
function summary(counts: Record<string, number> | null): string {
  if (!counts) return "—";
  return COUNT_LABELS.filter(([k]) => k in counts)
    .map(([k, one, many]) => `${formatNumber(counts[k])} ${counts[k] === 1 ? one : many}`)
    .join(" · ");
}

export function BackupsView() {
  const list = useQuery<BackupList>("/api/backups");
  const mfa = useQuery<{ enabled: boolean }>("/api/profile/mfa");
  const [creating, setCreating] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [integrity, setIntegrity] = React.useState<Integrity | null>(null);
  const [action, setAction] = React.useState<{ kind: "restore" | "delete"; backup: BackupRow } | null>(null);

  const create = async () => {
    setCreating(true);
    try {
      const b = await api.post<{ file: string }>("/api/backups");
      toast.success(`Backup ${b.file} created and verified`);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const checkIntegrity = async () => {
    setChecking(true);
    try {
      setIntegrity(await api.post<Integrity>("/api/backups/integrity"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const verify = async (b: BackupRow) => {
    try {
      const r = await api.post<{ ok: boolean; integrity: string; sha256Matches: boolean | null }>(`/api/backups/${encodeURIComponent(b.file)}/verify`);
      if (r.ok && r.sha256Matches !== false) toast.success(`${b.file} is intact`);
      else toast.error(`${b.file} failed verification (${r.sha256Matches === false ? "checksum changed" : r.integrity})`);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const download = async (b: BackupRow) => {
    try {
      await downloadFile(`/api/backups/${encodeURIComponent(b.file)}`);
      toast.success(`Downloaded ${b.file}. Keep it private: it contains every account's password hash.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const columns: Column<BackupRow>[] = [
    {
      key: "file",
      header: "Backup",
      render: (b) => (
        <div className="min-w-0">
          <div className="font-mono text-xs text-ink">{b.file}</div>
          <div className="text-xs text-ink-3">{summary(b.counts)}</div>
        </div>
      ),
    },
    { key: "created", header: "Created", render: (b) => <span title={formatDateTime(b.createdAt)}>{timeAgo(b.createdAt)}</span> },
    { key: "reason", header: "Type", hideBelow: "md", render: (b) => <Badge tone={REASON[b.reason]?.tone ?? "neutral"}>{REASON[b.reason]?.label ?? b.reason}</Badge> },
    { key: "by", header: "By", hideBelow: "lg", render: (b) => b.createdBy?.name ?? <span className="text-ink-3">System</span> },
    { key: "size", header: "Size", align: "right", hideBelow: "sm", render: (b) => <span className="tabular">{fileSize(b.sizeBytes)}</span> },
    {
      key: "verified",
      header: "Verified",
      hideBelow: "sm",
      render: (b) =>
        b.verified == null ? (
          <span className="text-xs text-ink-3">Unknown</span>
        ) : b.verified ? (
          <Badge tone="success" dot>OK</Badge>
        ) : (
          <Badge tone="danger" dot>Failed</Badge>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (b) => (
        <RowActions
          label={`Actions for ${b.file}`}
          actions={[
            { label: "Verify again", icon: ShieldCheck, onSelect: () => void verify(b) },
            { label: "Download", icon: Download, onSelect: () => void download(b) },
            { label: "Restore this backup", icon: RotateCcw, onSelect: () => setAction({ kind: "restore", backup: b }), separated: true, hidden: b.verified === false },
            { label: "Delete", icon: Trash2, onSelect: () => setAction({ kind: "delete", backup: b }), tone: "danger" },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Backup & Restore"
        description="Verified copies of the whole database, stored on this server. Only Super Admins can see this page."
        actions={
          <>
            <Button variant="secondary" onClick={checkIntegrity} loading={checking}>
              <ShieldCheck />Check database
            </Button>
            <Button onClick={create} loading={creating}>
              <DatabaseBackup />Back up now
            </Button>
          </>
        }
      />

      {integrity && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${integrity.ok ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft"}`}
        >
          {integrity.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
          <div className="text-ink">
            {integrity.ok ? "The live database passed its integrity check." : "The live database has problems. Restore a recent verified backup."} SQLite reported
            &ldquo;{integrity.integrity}&rdquo;, {integrity.foreignKeyViolations} foreign-key problems, {integrity.migrations.length} migrations applied,{" "}
            {fileSize(integrity.sizeBytes)} on disk ({integrity.journalMode}
            {integrity.walBytes ? `, ${fileSize(integrity.walBytes)} write-ahead log` : ""}). Checked in {integrity.durationMs} ms.
          </div>
        </div>
      )}

      <Card>
        <CardHeader
          title="Backups"
          description={
            list.data
              ? list.data.scheduledEveryHours > 0
                ? `Automatic backup every ${list.data.scheduledEveryHours} h; the latest ${list.data.keepScheduled} automatic backups are kept. Manual and safety backups are never removed automatically.`
                : "Automatic backups are turned off (BACKUP_INTERVAL_HOURS=0)."
              : undefined
          }
        />
        <DataTable
          caption="Database backups"
          columns={columns}
          rows={list.data?.backups}
          rowKey={(b) => b.file}
          loading={list.loading}
          refreshing={list.refreshing}
          error={list.error}
          onRetry={list.reload}
          empty={{ title: "No backups yet", description: "Create the first one with Back up now." }}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader title="How restoring works" />
        <CardBody className="space-y-2 text-[13px] text-ink-2">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>The backup is verified again (SQLite integrity and foreign keys) and must match this version&apos;s database schema.</li>
            <li>A safety backup of the current data is created first, so a restore can itself be undone.</li>
            <li>All data is replaced in a single transaction: either everything is restored or nothing changes.</li>
            <li>Everyone is signed out, including you. Sign in with an account that exists in the restored data.</li>
          </ol>
          {list.data && (
            <p className="pt-1 text-xs text-ink-3">
              Backup folder on the server: <span className="font-mono">{list.data.directory}</span>. Command line: <span className="font-mono">npm run db:backup</span>,{" "}
              <span className="font-mono">npm run db:restore -- &lt;file&gt;</span> (see docs/BACKUP_RESTORE.md).
            </p>
          )}
        </CardBody>
      </Card>

      <ReauthDialog
        open={action?.kind === "restore"}
        onOpenChange={(o) => !o && setAction(null)}
        title="Restore this backup?"
        description="All current data is replaced by the backup. A safety backup is taken first. Everyone is signed out."
        needsCode={!!mfa.data?.enabled}
        confirmLabel="Restore"
        confirmText="RESTORE"
        tone="danger"
        onConfirm={async (input) => {
          if (!action) return;
          await api.post(`/api/backups/${encodeURIComponent(action.backup.file)}/restore`, input);
          // Full page load on purpose: every session was cleared, so no client state may survive.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login?notice=restored");
        }}
      >
        {action && (
          <div className="rounded-md border border-line bg-canvas px-3 py-2 text-[13px]">
            <div className="font-mono text-xs text-ink">{action.backup.file}</div>
            <div className="text-xs text-ink-3">
              {formatDateTime(action.backup.createdAt)} · {summary(action.backup.counts)}
            </div>
          </div>
        )}
      </ReauthDialog>
      <ReauthDialog
        open={action?.kind === "delete"}
        onOpenChange={(o) => !o && setAction(null)}
        title="Delete this backup?"
        description={`${action?.backup.file ?? ""} is removed from the server permanently. This cannot be undone.`}
        needsCode={!!mfa.data?.enabled}
        confirmLabel="Delete backup"
        tone="danger"
        onConfirm={async (input) => {
          if (!action) return;
          await api.del(`/api/backups/${encodeURIComponent(action.backup.file)}`, input);
          toast.success(`Deleted ${action.backup.file}`);
          setAction(null);
          list.reload();
        }}
      />
    </div>
  );
}
