// List/query helpers shared by route handlers and services (no framework imports).

export interface ListQuery {
  page: number;
  pageSize: number;
  skip: number;
  q: string;
  sort: string | null;
  dir: "asc" | "desc";
  from: Date | null;
  to: Date | null;
}

export function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && value.length === 10) d.setHours(23, 59, 59, 999);
  return d;
}

export function parseListQuery(query: URLSearchParams, defaults: { pageSize?: number } = {}): ListQuery {
  const page = Math.max(1, Number(query.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.get("pageSize")) || defaults.pageSize || 10));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    q: (query.get("q") ?? "").trim(),
    sort: query.get("sort"),
    dir: query.get("dir") === "asc" ? "asc" : "desc",
    from: parseDate(query.get("from")),
    to: parseDate(query.get("to"), true),
  };
}

/** Only allows sorting by whitelisted columns (prevents arbitrary field access). */
export function orderBy<T extends string>(
  list: ListQuery,
  allowed: readonly T[],
  fallback: Record<string, "asc" | "desc">,
): Record<string, "asc" | "desc"> {
  if (list.sort && (allowed as readonly string[]).includes(list.sort)) return { [list.sort]: list.dir };
  return fallback;
}

export function paged<T>(items: T[], total: number, list: ListQuery) {
  return { items, total, page: list.page, pageSize: list.pageSize, pageCount: Math.max(1, Math.ceil(total / list.pageSize)) };
}

export function dateRange(list: ListQuery): { gte?: Date; lte?: Date } | undefined {
  if (!list.from && !list.to) return undefined;
  return { ...(list.from ? { gte: list.from } : {}), ...(list.to ? { lte: list.to } : {}) };
}


/** Date range from ?from=&to= (yyyy-MM-dd), defaulting to the last `defaultDays` days. */
export function parseRange(query: URLSearchParams, defaultDays = 30): { from: Date; to: Date } {
  const to = parseDate(query.get("to"), true) ?? new Date();
  let from = parseDate(query.get("from"));
  if (!from || from > to) {
    from = new Date(to);
    from.setDate(from.getDate() - (defaultDays - 1));
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}
