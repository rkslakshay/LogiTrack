"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Error thrown by the fetch helpers; carries per-field messages for forms. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let signingOut = false;
/** Called before sign-out so requests failing with 401 meanwhile do not redirect to /login?next=... */
export function markSigningOut() {
  signingOut = true;
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiClientError("Could not reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 401 && typeof window !== "undefined" && !signingOut && !url.startsWith("/api/auth/")) {
    // Session expired: a full page load to the login page clears all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(json?.error?.message ?? `Request failed (${res.status}).`, res.status, json?.error?.fieldErrors);
  }
  return json?.data as T;
}

export const api = {
  get: <T,>(url: string, signal?: AbortSignal) => request<T>("GET", url, undefined, signal),
  post: <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T,>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T,>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T,>(url: string, body?: unknown) => request<T>("DELETE", url, body),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  /** True on refetches when data from a previous request is still shown. */
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/** Minimal data-fetching hook: GET `url`, refetch when it changes, abort stale requests. */
export function useQuery<T>(url: string | null): QueryState<T> {
  const [tick, setTick] = useState(0);
  // `settled` records which request the stored result belongs to; the loading flags are derived from it.
  const [state, setState] = useState<{ data: T | null; resource: string | null; error: string | null; settled: string | null }>({
    data: null, resource: null, error: null, settled: null,
  });
  const requestKey = url ? `${url}#${tick}` : null;
  // The same endpoint with different query parameters (paging, filters) keeps showing its previous rows while it refetches.
  const resource = url ? url.split("?")[0] : null;

  useEffect(() => {
    if (!url || !requestKey) return;
    const controller = new AbortController();
    api
      .get<T>(url, controller.signal)
      .then((result) => setState({ data: result, resource: url.split("?")[0], error: null, settled: requestKey }))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({ ...prev, error: errorMessage(err), settled: requestKey }));
      });
    return () => controller.abort();
  }, [url, requestKey]);

  const data = resource === null || state.resource === resource ? state.data : null;
  const pending = requestKey !== null && state.settled !== requestKey;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => setState((prev) => ({ ...prev, data: updater(prev.data) })), []);
  return { data, loading: pending && data === null, refreshing: pending && data !== null, error: pending ? null : state.error, reload, setData };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ListState {
  page: number;
  pageSize: number;
  search: string;
  sort: string | null;
  dir: "asc" | "desc";
  filters: Record<string, string>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (search: string) => void;
  toggleSort: (column: string) => void;
  setFilter: (key: string, value: string) => void;
  resetFilters: () => void;
  /** Query string for the current state (search is debounced). */
  query: string;
  activeFilterCount: number;
}

/** Search + filters + sorting + pagination state for server-driven tables. */
export function useListState(initial: { pageSize?: number; sort?: string; dir?: "asc" | "desc"; filters?: Record<string, string> } = {}): ListState {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initial.pageSize ?? 10);
  const [search, setSearchState] = useState("");
  const [sort, setSort] = useState<string | null>(initial.sort ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(initial.dir ?? "desc");
  const [filters, setFilters] = useState<Record<string, string>>(initial.filters ?? {});
  const q = useDebounced(search.trim(), 300);
  const initialFilters = useRef(initial.filters ?? {});

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);
  const toggleSort = useCallback(
    (column: string) => {
      if (sort === column) setDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSort(column);
        setDir("asc");
      }
      setPage(1);
    },
    [sort],
  );
  const setFilter = useCallback((key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);
  const resetFilters = useCallback(() => {
    setFilters(initialFilters.current);
    setSearchState("");
    setPage(1);
  }, []);

  const query = useMemo(() => qs({ page, pageSize, q, sort, dir: sort ? dir : null, ...filters }), [page, pageSize, q, sort, dir, filters]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (search ? 1 : 0);

  return { page, pageSize, search, sort, dir, filters, setPage, setPageSize, setSearch, toggleSort, setFilter, resetFilters, query, activeFilterCount };
}

/** Triggers a file download for a same-origin URL (CSV exports). */
export async function downloadFile(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiClientError(json?.error?.message ?? "Export failed.", res.status);
  }
  const blob = await res.blob();
  const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "export.csv";
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return filename;
}
