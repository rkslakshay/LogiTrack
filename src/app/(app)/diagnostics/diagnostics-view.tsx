"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "@/lib/client";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { DetailList, ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { Badge, type Tone } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

interface Job {
  name: string;
  description: string;
  intervalMs: number;
  runs: number;
  failures: number;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  nextRunAt: string | null;
}
interface LogEntry {
  time: string;
  level: "warn" | "error" | "info" | "debug";
  scope: string;
  event: string;
  message?: string;
  requestId?: string;
  status?: number;
  path?: string;
  err?: { name?: string; message?: string };
}
interface Diagnostics {
  app: {
    name: string;
    version: string;
    environment: string;
    demoMode: boolean;
    node: string;
    platform: string;
    startedAt: string;
    uptimeSeconds: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    logLevel: string;
  };
  database: {
    ok: boolean;
    integrity?: string;
    foreignKeyViolations?: number;
    migrations?: string[];
    counts?: Record<string, number>;
    durationMs?: number;
    sizeBytes?: number;
    walBytes?: number;
    journalMode?: string;
    error?: string;
  };
  realtime: { available: boolean; connected: number; staffRoom: number; totalConnections: number; rejectedHandshakes: number; revokedDisconnects: number; lastConnectionAt: string | null };
  simulator: {
    running: boolean;
    waitingForViewers: boolean;
    movingVehicles: number;
    speed: number;
    tickMs: number;
    lastTickAt: string | null;
    ticks: number;
    failures: number;
    lastTickDurationMs: number | null;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  jobs: Job[];
  backups: { count: number; latest: { file: string; createdAt: string } | null; scheduledEveryHours: number };
  logs: { counts: Record<string, number>; recent: LogEntry[] };
  checkedAt: string;
}

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

function Health({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const tone: Tone = !ok ? "danger" : warn ? "warning" : "success";
  return <Badge tone={tone} dot>{label}</Badge>;
}

const mb = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function DiagnosticsView() {
  const { data, loading, refreshing, error, reload } = useQuery<Diagnostics>("/api/diagnostics");

  React.useEffect(() => {
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading && !data) return <LoadingState label="Checking the system…" />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { app, database: db, realtime, simulator, jobs, backups, logs } = data;
  const failingJobs = jobs.filter((j) => j.lastError);
  const lastBackupHours = backups.latest ? (new Date(data.checkedAt).getTime() - new Date(backups.latest.createdAt).getTime()) / 3_600_000 : null;
  const backupStale = lastBackupHours == null || (backups.scheduledEveryHours > 0 && lastBackupHours > backups.scheduledEveryHours * 2);

  return (
    <div>
      <PageHeader
        title="Diagnostics"
        description={`Live health of this LogiTrack server. Refreshes every 15 seconds; last checked ${formatDateTime(data.checkedAt)}.`}
        actions={
          <Button variant="secondary" onClick={reload} loading={refreshing}>
            <RefreshCw />Refresh
          </Button>
        }
      />

      <section aria-label="Summary" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Application", node: <Health ok label={`v${app.version} running`} /> },
          { label: "Database", node: <Health ok={db.ok} label={db.ok ? "Healthy" : "Problem"} /> },
          { label: "Realtime", node: <Health ok={realtime.available} label={realtime.available ? `${realtime.connected} connected` : "Not running"} /> },
          {
            label: "GPS simulator",
            node: <Health ok={!simulator.lastError || simulator.failures === 0} warn={!simulator.running} label={simulator.running ? (simulator.waitingForViewers ? "Idle (no viewers)" : "Running") : "Paused"} />,
          },
          { label: "Background jobs", node: <Health ok={failingJobs.length === 0} warn={backupStale} label={failingJobs.length ? `${failingJobs.length} failing` : lastBackupHours == null ? "No backup yet" : backupStale ? "Backup overdue" : "All OK"} /> },
        ].map((item) => (
          <Card key={item.label} className="px-4 py-3">
            <div className="text-xs text-ink-3">{item.label}</div>
            <div className="mt-1.5">{item.node}</div>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Application" />
          <CardBody>
            <DetailList
              items={[
                { label: "Version", value: `${app.name} ${app.version}` },
                { label: "Environment", value: `${app.environment}${app.demoMode ? " · demo mode" : ""}` },
                { label: "Uptime", value: `${uptime(app.uptimeSeconds)} (since ${formatDateTime(app.startedAt)})` },
                { label: "Runtime", value: `Node.js ${app.node} · ${app.platform}` },
                { label: "Memory", value: `${app.memory.rssMb} MB resident · heap ${app.memory.heapUsedMb}/${app.memory.heapTotalMb} MB` },
                { label: "Log level", value: app.logLevel },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Database" description="SQLite integrity and foreign-key checks run on every refresh." />
          <CardBody>
            {db.error ? (
              <p role="alert" className="text-[13px] text-danger">{db.error}</p>
            ) : (
              <DetailList
                items={[
                  { label: "Integrity", value: <Health ok={db.ok} label={db.integrity ?? "unknown"} /> },
                  { label: "Foreign-key problems", value: formatNumber(db.foreignKeyViolations ?? 0) },
                  { label: "Size", value: `${mb(db.sizeBytes)}${db.walBytes ? ` + ${mb(db.walBytes)} WAL` : ""} · ${db.journalMode}` },
                  { label: "Schema", value: `${db.migrations?.length ?? 0} migrations · ${db.migrations?.at(-1) ?? "none"}` },
                  { label: "Records", value: db.counts ? `${formatNumber(db.counts.Delivery ?? 0)} deliveries · ${formatNumber(db.counts.Vehicle ?? 0)} vehicles · ${formatNumber(db.counts.User ?? 0)} users` : "—" },
                  { label: "Check time", value: `${db.durationMs ?? 0} ms` },
                ]}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Realtime (Socket.IO)" />
          <CardBody>
            <DetailList
              items={[
                { label: "Status", value: <Health ok={realtime.available} label={realtime.available ? "Accepting connections" : "Not running in this process"} /> },
                { label: "Connected now", value: `${realtime.connected} (${realtime.staffRoom} staff)` },
                { label: "Connections since start", value: formatNumber(realtime.totalConnections) },
                { label: "Last connection", value: realtime.lastConnectionAt ? timeAgo(realtime.lastConnectionAt) : "—" },
                { label: "Refused handshakes", value: formatNumber(realtime.rejectedHandshakes) },
                { label: "Disconnected (revoked)", value: formatNumber(realtime.revokedDisconnects) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="GPS simulator" description="Simulated positions only; no hardware GPS." />
          <CardBody>
            <DetailList
              items={[
                { label: "State", value: simulator.running ? (simulator.waitingForViewers ? "Running, idle until someone connects" : "Running") : "Paused" },
                { label: "Moving vehicles", value: formatNumber(simulator.movingVehicles) },
                { label: "Speed", value: `${simulator.speed}× · tick every ${simulator.tickMs / 1000} s` },
                { label: "Last tick", value: simulator.lastTickAt ? `${timeAgo(simulator.lastTickAt)} (${simulator.lastTickDurationMs ?? 0} ms)` : "—" },
                { label: "Ticks / failures", value: `${formatNumber(simulator.ticks)} / ${formatNumber(simulator.failures)}` },
                { label: "Last error", value: simulator.lastError ? `${simulator.lastError} (${timeAgo(simulator.lastErrorAt)})` : "None" },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Background jobs" description={backups.latest ? `Latest backup ${backups.latest.file}, ${timeAgo(backups.latest.createdAt)}.` : "No backups yet."} />
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Background jobs</caption>
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-left text-xs text-ink-3">
                <th scope="col" className="px-4 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Every</th>
                <th scope="col" className="px-3 py-2 font-medium">Last run</th>
                <th scope="col" className="px-3 py-2 font-medium">Runs / failures</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-3">No background jobs in this process (they run under the custom server, not plain next dev).</td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={j.name} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <div className="font-medium text-ink">{j.name}</div>
                    <div className="text-xs text-ink-3">{j.description}</div>
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap">{j.intervalMs >= 3_600_000 ? `${j.intervalMs / 3_600_000} h` : `${j.intervalMs / 60_000} min`}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{j.lastRunAt ? `${timeAgo(j.lastRunAt)} (${j.lastDurationMs} ms)` : "Not yet"}</td>
                  <td className="tabular px-3 py-2">{j.runs} / {j.failures}</td>
                  <td className="px-3 py-2">
                    {j.running ? <Badge tone="info">Running</Badge> : j.lastError ? <span title={j.lastError}><Badge tone="danger" dot>Failed</Badge></span> : <Badge tone="success" dot>OK</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Recent warnings and errors"
          description={`Since the server started: ${formatNumber(logs.counts.error ?? 0)} errors, ${formatNumber(logs.counts.warn ?? 0)} warnings. Secrets and e-mail addresses are removed before logging.`}
        />
        {logs.recent.length === 0 ? (
          <CardBody className="text-[13px] text-ink-3">Nothing to report.</CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {logs.recent.map((e, i) => (
              <li key={`${e.time}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                <Badge tone={e.level === "error" ? "danger" : "warning"}>{e.level}</Badge>
                <span className="font-mono text-xs text-ink">{e.scope}/{e.event}</span>
                <span className="min-w-0 flex-1 break-words text-ink-2">
                  {e.err?.message ?? e.message ?? ""}
                  {e.path ? ` ${e.path}` : ""}
                  {e.status ? ` (${e.status})` : ""}
                  {e.requestId ? <span className="text-ink-3"> · request {e.requestId.slice(0, 8)}</span> : null}
                </span>
                <time dateTime={e.time} className="text-xs text-ink-3" title={formatDateTime(e.time)}>{timeAgo(e.time)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
