import { logger } from "@/lib/logger";

/**
 * Background job registry. Each job runs on an interval in this process; its last
 * run, duration, result and error are kept for the diagnostics page, and failures
 * are logged. A job never overlaps itself.
 */

const log = logger("jobs");

export interface JobStatus {
  name: string;
  description: string;
  intervalMs: number;
  runs: number;
  failures: number;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastResult: unknown;
  lastError: string | null;
  lastErrorAt: string | null;
  nextRunAt: string | null;
}

interface Job extends JobStatus {
  fn: () => Promise<unknown>;
  timer: NodeJS.Timeout | null;
  firstRun: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __logitrackJobs?: Map<string, Job> };
const jobs = (g.__logitrackJobs ??= new Map());

export async function runJob(name: string): Promise<unknown> {
  const job = jobs.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);
  if (job.running) return undefined;
  job.running = true;
  const started = Date.now();
  try {
    const result = await job.fn();
    job.lastResult = result ?? null;
    job.lastError = null;
    return result;
  } catch (err) {
    job.failures++;
    job.lastError = err instanceof Error ? err.message : String(err);
    job.lastErrorAt = new Date().toISOString();
    log.error("job.failed", { job: name, err });
    return undefined;
  } finally {
    job.runs++;
    job.running = false;
    job.lastRunAt = new Date(started).toISOString();
    job.lastDurationMs = Date.now() - started;
    job.nextRunAt = job.timer ? new Date(Date.now() + job.intervalMs).toISOString() : null;
  }
}

/** Registers and schedules a job. `firstRunMs` delays the first run after start-up. */
export function scheduleJob(name: string, description: string, intervalMs: number, fn: () => Promise<unknown>, firstRunMs = intervalMs) {
  const existing = jobs.get(name);
  if (existing?.timer) clearInterval(existing.timer);
  if (existing?.firstRun) clearTimeout(existing.firstRun);
  const job: Job = {
    name, description, intervalMs, fn, timer: null, firstRun: null, runs: 0, failures: 0, running: false, lastRunAt: null, lastDurationMs: null,
    lastResult: null, lastError: null, lastErrorAt: null, nextRunAt: new Date(Date.now() + firstRunMs).toISOString(),
  };
  jobs.set(name, job);
  job.firstRun = setTimeout(() => void runJob(name), firstRunMs);
  job.firstRun.unref();
  job.timer = setInterval(() => void runJob(name), intervalMs);
  job.timer.unref();
}

/** Stops every scheduled job (shutdown, or a start-up that failed after jobs were scheduled). */
export function stopAllJobs() {
  for (const job of jobs.values()) {
    if (job.timer) clearInterval(job.timer);
    if (job.firstRun) clearTimeout(job.firstRun);
    job.timer = null;
    job.firstRun = null;
    job.nextRunAt = null;
  }
}

export function jobStatus(): JobStatus[] {
  return [...jobs.values()].map((j) => ({
    name: j.name, description: j.description, intervalMs: j.intervalMs, runs: j.runs, failures: j.failures, running: j.running,
    lastRunAt: j.lastRunAt, lastDurationMs: j.lastDurationMs, lastResult: j.lastResult, lastError: j.lastError, lastErrorAt: j.lastErrorAt,
    nextRunAt: j.nextRunAt,
  }));
}
