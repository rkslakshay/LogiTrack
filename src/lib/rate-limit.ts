/**
 * In-memory sliding-window rate limiter.
 *
 * Simple and dependency-free, which suits a single-process application. The
 * counters live in this process: they reset on restart and are not shared between
 * processes (documented in docs/SECURITY_HARDENING.md). Account lockout, which must
 * survive restarts, is stored in the database instead.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest counted hit leaves the window. */
  retryAfterMs: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    readonly name: string,
    private windowMs: number,
    private max: number,
    private maxKeys = 10_000,
  ) {}

  /** Records an attempt and says whether it is allowed. */
  hit(key: string, now = Date.now()): RateLimitResult {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs: this.windowMs - (now - recent[0]) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      // Bound memory under key-spraying: drop the oldest fifth of the keys.
      for (const k of [...this.hits.keys()].slice(0, Math.ceil(this.maxKeys / 5))) this.hits.delete(k);
    }
    return { allowed: true, remaining: this.max - recent.length, retryAfterMs: 0 };
  }

  /** Checks without recording. */
  peek(key: string, now = Date.now()): RateLimitResult {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return recent.length >= this.max
      ? { allowed: false, remaining: 0, retryAfterMs: this.windowMs - (now - recent[0]) }
      : { allowed: true, remaining: this.max - recent.length, retryAfterMs: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }
}

const g = globalThis as unknown as { __logitrackLimiters?: Map<string, RateLimiter> };
const registry = (g.__logitrackLimiters ??= new Map());

/** Process-wide limiter, shared between the Next.js bundle and the custom server. */
export function limiter(name: string, windowMs: number, max: number): RateLimiter {
  let l = registry.get(name);
  if (!l) {
    l = new RateLimiter(name, windowMs, max);
    registry.set(name, l);
  }
  return l;
}

/** Limits used across the application, in one place so they are easy to review. */
export const LIMITS = {
  /** Sign-in attempts from one client address. */
  // LOGIN_LIMIT_PER_ADDRESS exists for automated test servers that sign in hundreds of times from one address.
  loginPerAddress: () => limiter("login:address", 15 * 60_000, Math.max(5, Number(process.env.LOGIN_LIMIT_PER_ADDRESS) || 30)),
  /** Failed sign-ins for one e-mail address that has no account (real accounts lock in the database). */
  loginUnknownAccount: () => limiter("login:unknown", 15 * 60_000, 10),
  /** Two-factor code attempts for one user, across challenges. */
  mfaPerUser: () => limiter("mfa:user", 15 * 60_000, 10),
  /** Password-reset submissions from one client address. */
  resetPerAddress: () => limiter("reset:address", 15 * 60_000, 10),
  /** Re-authentication attempts (sensitive actions) for one user. */
  reauthPerUser: () => limiter("reauth:user", 15 * 60_000, 10),
  /** State-changing API requests for one signed-in user. */
  writesPerUser: () => limiter("api:writes", 60_000, 240),
  /** CSV imports for one user. */
  importsPerUser: () => limiter("api:imports", 60_000, 20),
  /** Manual backups for one user (each one copies the whole database). */
  backupsPerUser: () => limiter("api:backups", 60 * 60_000, 20),
} as const;

export function resetAllLimiters() {
  for (const l of registry.values()) l.clear();
}
