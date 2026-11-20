"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import type { ListState } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, TableSkeleton } from "./page";

export interface Column<T> {
  key: string;
  header: string;
  /** Server-side sort column; omit for non-sortable columns. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide on small screens. */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
  render: (row: T) => React.ReactNode;
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell", "2xl": "hidden 2xl:table-cell" } as const;
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
  sort?: string | null;
  dir?: "asc" | "desc";
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string; action?: React.ReactNode };
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, refreshing, error, onRetry, sort, dir, onSort, onRowClick, empty, caption }: DataTableProps<T>) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows) return <TableSkeleton columns={Math.min(6, columns.length)} />;
  if (!rows || rows.length === 0) {
    return <EmptyState title={empty?.title ?? "Nothing to show"} description={empty?.description} action={empty?.action} />;
  }
  return (
    <div className={cn("scroll-thin overflow-x-auto transition-opacity", refreshing && "opacity-60")} tabIndex={0} role="region" aria-label={caption ?? "Table"}>
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-canvas/70">
            {columns.map((col) => {
              const active = !!col.sortKey && sort === col.sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("whitespace-nowrap px-3 py-2 text-xs font-medium text-ink-3", ALIGN[col.align ?? "left"], col.hideBelow && HIDE[col.hideBelow], col.className)}
                >
                  {col.sortKey && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey!)}
                      className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink", active && "text-ink")}
                      title={`Sort by ${col.header}`}
                    >
                      {col.header}
                      {active ? (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-50" />}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // Clickable rows are reachable with Tab and open with Enter or Space, like the mouse.
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn("border-b border-line last:border-0", onRowClick && "cursor-pointer hover:bg-canvas/70 focus-visible:bg-primary-soft")}
            >
              {columns.map((col) => (
                <td key={col.key} className={cn("px-3 py-2.5 align-middle text-ink", ALIGN[col.align ?? "left"], col.hideBelow && HIDE[col.hideBelow], col.className)}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
  noun = "records",
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  noun?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5 text-[13px] text-ink-3">
      <p className="tabular">
        Showing <span className="font-medium text-ink">{from}</span>–<span className="font-medium text-ink">{to}</span> of{" "}
        <span className="font-medium text-ink">{total}</span> {noun}
      </p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-8 w-[70px]" aria-label="Rows per page">
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <span className="tabular px-1">
          Page {page} of {pageCount}
        </span>
        <Button variant="secondary" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="secondary" size="icon" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden" />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-ink-3 hover:text-ink" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn("w-full sm:w-auto sm:min-w-36", className)}>
      <option value="">{allLabel ?? `All ${label.toLowerCase()}`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function DateRangeFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} aria-label="From date" className="w-[140px]" />
      <span className="text-xs text-ink-3">to</span>
      <Input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} aria-label="To date" className="w-[140px]" />
    </div>
  );
}

/** Toolbar row above a table: search and filters on the left, reset on the right. */
export function Toolbar({ list, children }: { list?: ListState; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
      {children}
      {list && list.activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={list.resetFilters}>
          <X />
          Clear
        </Button>
      )}
    </div>
  );
}
