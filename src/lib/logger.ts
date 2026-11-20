/**
 * Structured logging.
 *
 * Every entry is one JSON object per line on stdout (or a readable single line in
 * development), so logs can be read by people and by tools such as `jq`, Docker's
 * log driver or any log shipper, without a paid service.
 *
 * Safety rules, enforced here rather than at every call site:
 *  - Fields whose name suggests a secret (password, token, secret, cookie,
 *    authorization, code, hash...) are replaced with "[redacted]".
 *  - Email addresses anywhere in a value are masked (a****@example.com).
 *  - Errors are reduced to name, message and (server-side only) stack.
 *
 * Warnings and errors are also kept in a small in-memory ring buffer that the
 * administrator diagnostics page reads. It holds the most recent entries since
 * the process started and is not persisted.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface LogEntry {
  time: string;
  level: LogLevel;
  /** Area of the application, e.g. "auth", "api", "simulator". */
  scope: string;
  event: string;
  message?: string;
  [key: string]: unknown;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /pass(word)?|secret|token|cookie|authori[sz]ation|session|credential|otp|totp|recovery|hash|^code$|api[-_]?key/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const RING_SIZE = 200;

interface LoggerState {
  ring: LogEntry[];
  counts: Record<LogLevel, number>;
  /** Replaceable for tests. */
  write: (line: string, level: LogLevel) => void;
}

const g = globalThis as unknown as { __logitrackLogger?: LoggerState };
const state: LoggerState =
  g.__logitrackLogger ??
  (g.__logitrackLogger = {
    ring: [],
    counts: { debug: 0, info: 0, warn: 0, error: 0 },
    write: (line, level) => (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n"),
  });

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase() as LogLevel;
  if (configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === "test" ? LEVELS.warn : LEVELS.info;
}

/** Masks e-mail addresses so personal data does not end up in logs. */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, (_m, first: string, domain: string) => `${first}****@${domain}`);
}

/** Removes secrets and personal data from anything that is about to be logged. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return maskEmails(value.length > 2000 ? `${value.slice(0, 2000)}…` : value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskEmails(value.message),
      ...("code" in value && typeof value.code === "string" ? { code: value.code } : {}),
      ...(value.stack ? { stack: maskEmails(value.stack.split("\n").slice(0, 8).join("\n")) } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function emit(level: LogLevel, scope: string, event: string, fields: LogFields = {}) {
  const { message, err, ...rest } = fields;
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    scope,
    event,
    ...(message ? { message: maskEmails(String(message)) } : {}),
    ...(sanitize(rest) as Record<string, unknown>),
    ...(err !== undefined ? { error: sanitize(err) } : {}),
  };
  state.counts[level]++;
  if (level === "warn" || level === "error") {
    state.ring.push(entry);
    if (state.ring.length > RING_SIZE) state.ring.shift();
  }
  if (LEVELS[level] < threshold()) return;
  const pretty = process.env.LOG_FORMAT === "pretty" || (process.env.LOG_FORMAT !== "json" && process.env.NODE_ENV === "development");
  if (pretty) {
    const { time, level: l, scope: s, event: e, message: m, ...extra } = entry;
    const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
    state.write(`${time.slice(11, 19)} ${l.toUpperCase().padEnd(5)} [${s}] ${e}${m ? `: ${m}` : ""}${tail}`, level);
  } else {
    state.write(JSON.stringify(entry), level);
  }
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** A logger for one area of the application: `const log = logger("auth")`. */
export function logger(scope: string): Logger {
  return {
    debug: (event, fields) => emit("debug", scope, event, fields),
    info: (event, fields) => emit("info", scope, event, fields),
    warn: (event, fields) => emit("warn", scope, event, fields),
    error: (event, fields) => emit("error", scope, event, fields),
  };
}

/** Recent warnings and errors, newest first (diagnostics page). */
export function recentProblems(limit = 50): LogEntry[] {
  return state.ring.slice(-limit).reverse();
}

export function logCounts(): Record<LogLevel, number> {
  return { ...state.counts };
}

/** Test hook: capture output instead of writing to the console. */
export function captureLogs(): { lines: string[]; restore: () => void } {
  const previous = state.write;
  const lines: string[] = [];
  state.write = (line) => lines.push(line);
  return { lines, restore: () => (state.write = previous) };
}

export function clearRecentProblems() {
  state.ring.length = 0;
}
