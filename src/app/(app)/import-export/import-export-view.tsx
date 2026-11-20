"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, RotateCcw, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile, errorMessage, qs, useQuery } from "@/lib/client";
import { formatNumber } from "@/lib/format";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { Badge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type EntityName = "vehicles" | "drivers" | "deliveries" | "fuel" | "maintenance";

interface Column {
  header: string;
  field: string;
  required: boolean;
  description: string;
  example: string;
}
interface EntityInfo {
  name: EntityName;
  columns: Column[];
  canImport: boolean;
  canExport: boolean;
}
interface Catalogue {
  maxBytes: number;
  maxRows: number;
  entities: EntityInfo[];
}
interface RowResult {
  line: number;
  status: "valid" | "invalid" | "duplicate";
  errors: Record<string, string>;
  values: Record<string, string>;
  code?: string | null;
}
interface ImportResult {
  committed: boolean;
  columns: { header: string; required: boolean }[];
  ignoredColumns: string[];
  rows: RowResult[];
  summary: { total: number; valid: number; invalid: number; duplicate: number; imported: number; skipped: number };
}

const LABELS: Record<EntityName, { title: string; one: string; many: string; href: string }> = {
  vehicles: { title: "Vehicles", one: "vehicle", many: "vehicles", href: "/vehicles" },
  drivers: { title: "Drivers", one: "driver", many: "drivers", href: "/drivers" },
  deliveries: { title: "Deliveries", one: "delivery", many: "deliveries", href: "/deliveries" },
  fuel: { title: "Fuel records", one: "fuel record", many: "fuel records", href: "/fuel" },
  maintenance: { title: "Maintenance records", one: "maintenance record", many: "maintenance records", href: "/maintenance" },
};

const STATUS_FILTERS: Partial<Record<EntityName, { value: string; label: string }[]>> = {
  vehicles: ["AVAILABLE", "ON_DELIVERY", "MAINTENANCE", "INACTIVE"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) })),
  drivers: ["AVAILABLE", "ON_DELIVERY", "OFF_DUTY", "INACTIVE"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) })),
  deliveries: ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELAYED", "DELIVERED", "FAILED", "CANCELLED"].map((v) => ({
    value: v,
    label: v.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
  })),
  maintenance: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) })),
};
const DATED: EntityName[] = ["deliveries", "fuel", "maintenance"];
const SEARCHABLE: EntityName[] = ["vehicles", "drivers", "deliveries"];

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function ImportExportView() {
  const { data, loading, error, reload } = useQuery<Catalogue>("/api/data");
  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const importable = data.entities.filter((e) => e.canImport);
  const exportable = data.entities.filter((e) => e.canExport);

  return (
    <div>
      <PageHeader
        title="Import & Export"
        description="Bring records in from spreadsheets with a full check before anything is saved, or download them in the same format."
      />
      <Tabs defaultValue={importable.length ? "import" : "export"}>
        <TabsList aria-label="Import or export">
          {importable.length > 0 && (
            <TabsTrigger value="import">
              <Upload aria-hidden />Import
            </TabsTrigger>
          )}
          <TabsTrigger value="export">
            <Download aria-hidden />Export
          </TabsTrigger>
        </TabsList>
        {importable.length > 0 && (
          <TabsContent value="import">
            <ImportPanel entities={importable} maxBytes={data.maxBytes} maxRows={data.maxRows} />
          </TabsContent>
        )}
        <TabsContent value="export">
          <ExportPanel entities={exportable} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Import ------------------------------------------------------------------------

function ImportPanel({ entities, maxBytes, maxRows }: { entities: EntityInfo[]; maxBytes: number; maxRows: number }) {
  const [entity, setEntity] = React.useState<EntityName>(entities[0].name);
  const [file, setFile] = React.useState<{ name: string; size: number; text: string } | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "commit" | null>(null);
  const [skipInvalid, setSkipInvalid] = React.useState(false);
  const [onlyProblems, setOnlyProblems] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const info = entities.find((e) => e.name === entity)!;
  const label = LABELS[entity];

  const reset = () => {
    setFile(null);
    setResult(null);
    setProblem(null);
    setSkipInvalid(false);
    setOnlyProblems(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const choose = async (f: File | undefined) => {
    setResult(null);
    setProblem(null);
    if (!f) return setFile(null);
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return setProblem("Choose a .csv file. In Excel, use File → Save As → CSV UTF-8.");
    if (f.size > maxBytes) return setProblem(`This file is ${kb(f.size)}; the limit is ${kb(maxBytes)}. Split it into smaller files.`);
    setFile({ name: f.name, size: f.size, text: await f.text() });
  };

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(commit ? "commit" : "preview");
    setProblem(null);
    try {
      const r = await api.post<ImportResult>(`/api/data/${entity}/import`, { csv: file.text, fileName: file.name, commit, skipInvalid: commit && skipInvalid });
      setResult(r);
      if (commit) {
        if (r.committed) toast.success(`Imported ${formatNumber(r.summary.imported)} ${r.summary.imported === 1 ? label.one : label.many}`);
        else toast.error("Nothing was imported. Fix the rows listed below, or choose to skip them.");
      }
    } catch (err) {
      setResult(null);
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  const template = async () => {
    try {
      await downloadFile(`/api/data/${entity}/template`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const s = result?.summary;
  const problems = s ? s.invalid + s.duplicate : 0;
  const canCommit = !!s && !result?.committed && s.valid > 0 && (problems === 0 || skipInvalid);
  const shown = result ? (onlyProblems ? result.rows.filter((r) => r.status !== "valid") : result.rows) : [];
  const previewColumns = result ? result.columns.slice(0, 4).map((c) => c.header) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="1. Choose what to import and the file" description={`Up to ${formatNumber(maxRows)} rows and ${kb(maxBytes)} per file. Nothing is saved until you confirm.`} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="import-entity">Data type</Label>
              <Select
                id="import-entity"
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as EntityName);
                  reset();
                }}
              >
                {entities.map((e) => (
                  <option key={e.name} value={e.name}>{LABELS[e.name].title}</option>
                ))}
              </Select>
              <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={template}>
                <Download aria-hidden />Download the {label.many} template
              </Button>
            </div>
            <div>
              <Label htmlFor="import-file">CSV file</Label>
              <Input id="import-file" ref={inputRef} type="file" accept=".csv,text/csv" onChange={(e) => void choose(e.target.files?.[0])} aria-describedby="import-file-hint" />
              <FieldHint>
                <span id="import-file-hint">{file ? `${file.name} · ${kb(file.size)}` : "UTF-8 CSV with a header row. Column order does not matter."}</span>
              </FieldHint>
            </div>
          </CardBody>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {(file || result) && (
              <Button variant="ghost" onClick={reset} disabled={!!busy}>
                <RotateCcw aria-hidden />Start over
              </Button>
            )}
            <Button onClick={() => void send(false)} disabled={!file || !!busy} loading={busy === "preview"}>
              <FileUp aria-hidden />Check file
            </Button>
          </div>
        </Card>

        {problem && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-ink">
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            {problem}
          </div>
        )}

        {result && s && (
          <Card>
            <CardHeader
              title={result.committed ? "Import complete" : "2. Review the check"}
              description={
                result.committed
                  ? `${formatNumber(s.imported)} ${s.imported === 1 ? label.one : label.many} saved${s.skipped ? `, ${formatNumber(s.skipped)} rows skipped` : ""}.`
                  : "Every row was validated with the same rules as the forms. Nothing has been saved yet."
              }
              action={
                result.committed ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={label.href}>Open {label.title.toLowerCase()}</Link>
                  </Button>
                ) : undefined
              }
            />
            <div role="status" aria-live="polite" className="flex flex-wrap gap-2 border-b border-line px-4 py-3 text-[13px]">
              <Badge tone="neutral">{formatNumber(s.total)} rows</Badge>
              <Badge tone="success" dot>{formatNumber(s.valid)} ready</Badge>
              {s.invalid > 0 && <Badge tone="danger" dot>{formatNumber(s.invalid)} with errors</Badge>}
              {s.duplicate > 0 && <Badge tone="warning" dot>{formatNumber(s.duplicate)} {s.duplicate === 1 ? "duplicate" : "duplicates"}</Badge>}
              {result.ignoredColumns.length > 0 && <span className="text-xs text-ink-3">Ignored columns: {result.ignoredColumns.join(", ")}</span>}
            </div>
            {problems > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 pt-3">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
                  Show only rows with problems
                </label>
              </div>
            )}
            <div className="scroll-thin max-h-[480px] overflow-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Import check, one row per line of the file</caption>
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th scope="col" className="px-4 py-2 font-medium">Line</th>
                    <th scope="col" className="px-3 py-2 font-medium">Result</th>
                    {previewColumns.map((h) => (
                      <th key={h} scope="col" className="hidden px-3 py-2 font-medium md:table-cell">{h}</th>
                    ))}
                    <th scope="col" className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line} className="border-b border-line align-top last:border-0">
                      <td className="tabular px-4 py-2 text-ink-3">{r.line}</td>
                      <td className="px-3 py-2">
                        {r.status === "valid" ? (
                          <Badge tone="success" dot>{result.committed ? r.code ?? "Saved" : "Ready"}</Badge>
                        ) : r.status === "duplicate" ? (
                          <Badge tone="warning" dot>Duplicate</Badge>
                        ) : (
                          <Badge tone="danger" dot>Error</Badge>
                        )}
                      </td>
                      {previewColumns.map((h) => (
                        <td key={h} className="hidden max-w-48 truncate px-3 py-2 text-ink-2 md:table-cell" title={r.values[h]}>{r.values[h] || "—"}</td>
                      ))}
                      <td className="px-3 py-2">
                        {Object.keys(r.errors).length === 0 ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {Object.entries(r.errors).map(([col, msg]) => (
                              <li key={col} className={r.status === "duplicate" ? "text-warning" : "text-danger"}>
                                {col !== "_" && <span className="font-medium">{col}: </span>}
                                {msg}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.committed && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                {problems > 0 ? (
                  <label className="flex items-center gap-2 text-[13px] text-ink">
                    <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
                    Skip the {formatNumber(problems)} rows with problems and import the rest
                  </label>
                ) : (
                  <span className="flex items-center gap-1.5 text-[13px] text-success">
                    <CheckCircle2 className="size-4" aria-hidden />All rows passed
                  </span>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={reset} disabled={!!busy}>Cancel</Button>
                  <Button onClick={() => setConfirming(true)} disabled={!canCommit || !!busy}>
                    Import {formatNumber(s.valid)} {s.valid === 1 ? label.one : label.many}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader title={`${label.title} columns`} description="Required columns are marked. Extra columns are ignored." />
        <ul className="divide-y divide-line">
          {info.columns.map((c) => (
            <li key={c.field} className="px-4 py-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{c.header}</span>
                {c.required ? <Badge tone="info">Required</Badge> : <span className="text-xs text-ink-3">Optional</span>}
              </div>
              <p className="text-xs text-ink-3">{c.description}</p>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Import ${s ? formatNumber(s.valid) : ""} ${s?.valid === 1 ? label.one : label.many}?`}
        description={
          problems > 0
            ? `${formatNumber(problems)} rows with problems will be skipped. The other rows are saved together: if anything fails, nothing is saved.`
            : "All rows are saved together: if anything fails, nothing is saved. The import is recorded in the activity log."
        }
        confirmLabel="Import"
        tone="primary"
        loading={busy === "commit"}
        onConfirm={() => void send(true)}
      />
    </div>
  );
}

// --- Export ------------------------------------------------------------------------

function ExportPanel({ entities }: { entities: EntityInfo[] }) {
  const [entity, setEntity] = React.useState<EntityName>(entities[0]?.name ?? "vehicles");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (entities.length === 0) return <p className="text-[13px] text-ink-3">Your role has no data to export here.</p>;

  const run = async () => {
    setBusy(true);
    try {
      const file = await downloadFile(`/api/data/${entity}/export${qs({ q: SEARCHABLE.includes(entity) ? q : "", status, from: DATED.includes(entity) ? from : "", to: DATED.includes(entity) ? to : "" })}`);
      toast.success(`Downloaded ${file}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const statuses = STATUS_FILTERS[entity];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Export records" description="Same columns as the import templates, so a file can be edited and imported again. Passwords and security data are never included." />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="export-entity">Data type</Label>
            <Select
              id="export-entity"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as EntityName);
                setStatus("");
              }}
            >
              {entities.map((e) => (
                <option key={e.name} value={e.name}>{LABELS[e.name].title}</option>
              ))}
            </Select>
          </div>
          {SEARCHABLE.includes(entity) && (
            <div>
              <Label htmlFor="export-q">Contains</Label>
              <Input id="export-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={entity === "vehicles" ? "Registration or name" : entity === "drivers" ? "Name or email" : "Code or customer"} />
            </div>
          )}
          {statuses && (
            <div>
              <Label htmlFor="export-status">Status</Label>
              <Select id="export-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {statuses.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          )}
          {DATED.includes(entity) && (
            <>
              <div>
                <Label htmlFor="export-from">From</Label>
                <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="export-to">To</Label>
                <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
        </CardBody>
        <div className="flex justify-end border-t border-line px-4 py-3">
          <Button onClick={run} loading={busy}>
            <Download aria-hidden />Download CSV
          </Button>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Reports" description="Analytics, driver performance, fuel efficiency and the activity log are exported from Reports." />
        <CardBody className="text-[13px] text-ink-2">
          <p>Reports are calculated summaries for a date range, formatted for reading in a spreadsheet rather than for importing.</p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href="/reports">
              <FileSpreadsheet aria-hidden />Open Reports
            </Link>
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
