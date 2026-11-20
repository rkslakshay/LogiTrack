"use client";

import { useState } from "react";
import { Activity, BarChart3, Download, FileSpreadsheet, Fuel, Gauge, Package, Truck, Users, Wrench, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, errorMessage, useQuery } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/page";
import { useRange } from "@/components/app/range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

const REPORTS: { type: string; title: string; description: string; icon: LucideIcon }[] = [
  { type: "deliveries", title: "Deliveries", description: "Every delivery scheduled in the period with driver, vehicle, timings and on-time flag.", icon: Package },
  { type: "vehicles", title: "Vehicle performance", description: "Deliveries, distance, fuel and maintenance cost and utilisation per vehicle.", icon: Truck },
  { type: "drivers", title: "Driver performance", description: "Ranked driver statistics: success rate, on-time rate, distance and score.", icon: Users },
  { type: "fuel", title: "Fuel records", description: "All fuel fills with quantity, price, total cost, odometer and station.", icon: Fuel },
  { type: "fuel-efficiency", title: "Fuel efficiency", description: "Mileage (km/L) and cost per km per vehicle, calculated fill-to-fill.", icon: Gauge },
  { type: "maintenance", title: "Maintenance records", description: "Service history with costs, providers and next-service reminders.", icon: Wrench },
  { type: "analytics", title: "Analytics", description: "Delivery outcomes and costs per day or week, with the period's key rates.", icon: BarChart3 },
  { type: "activity", title: "Activity log", description: "Audit trail of user actions in the period.", icon: Activity },
];

interface Preview {
  title: string;
  headers: string[];
  rowCount: number;
  preview: (string | number | null)[][];
}

export function ReportsView() {
  const range = useRange("30d");
  const [selected, setSelected] = useState(REPORTS[0].type);
  const [downloading, setDownloading] = useState<string | null>(null);
  const preview = useQuery<Preview>(`/api/reports/${selected}?${range.query}&format=json`);
  const report = REPORTS.find((r) => r.type === selected)!;

  const download = async (type: string) => {
    setDownloading(type);
    try {
      toast.success(`Downloaded ${await downloadFile(`/api/reports/${type}?${range.query}`)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader title="Reports" description="Preview any report for a date range and export it as CSV." actions={range.picker} />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Available reports" description={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
          <ul className="divide-y divide-line">
            {REPORTS.map((r) => (
              <li key={r.type} className={`flex items-center gap-3 px-3 py-2.5 ${r.type === selected ? "bg-primary-soft/50" : ""}`}>
                <button type="button" onClick={() => setSelected(r.type)} aria-pressed={r.type === selected} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-md ${r.type === selected ? "bg-primary text-white" : "bg-neutral-soft text-ink-2"}`}>
                    <r.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{r.title}</span>
                    <span className="block text-xs text-ink-3">{r.description}</span>
                  </span>
                </button>
                <Button variant="ghost" size="icon" loading={downloading === r.type} onClick={() => download(r.type)} aria-label={`Download ${r.title} CSV`} title="Download CSV">
                  {downloading !== r.type && <Download />}
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title={`${report.title} · preview`}
            description={preview.data ? `${preview.data.rowCount} row${preview.data.rowCount === 1 ? "" : "s"} in this period · showing the first ${Math.min(8, preview.data.rowCount)}` : "Loading preview…"}
            action={
              <Button size="sm" loading={downloading === selected} disabled={!preview.data?.rowCount} onClick={() => download(selected)}>
                <FileSpreadsheet />
                Export CSV
              </Button>
            }
          />
          {preview.error ? (
            <ErrorState message={preview.error} onRetry={preview.reload} />
          ) : preview.loading || !preview.data ? (
            <LoadingState />
          ) : preview.data.rowCount === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-ink-3">No records in this period. Choose a wider date range.</p>
          ) : (
            <div className={`scroll-thin overflow-x-auto ${preview.refreshing ? "opacity-60" : ""}`} tabIndex={0} role="region" aria-label="Report preview">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line bg-canvas/70 text-left text-ink-3">
                    {preview.data.headers.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.preview.map((row, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {row.map((cell, j) => <td key={j} className="max-w-56 truncate whitespace-nowrap px-3 py-2 text-ink" title={String(cell ?? "")}>{cell === "" || cell == null ? "—" : String(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
            Exports are UTF-8 CSV files that open directly in Excel, Google Sheets or LibreOffice. Amounts are in INR.
          </p>
        </Card>
      </div>
    </>
  );
}
