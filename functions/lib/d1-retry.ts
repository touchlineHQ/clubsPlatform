/**
 * Retry for D1's transient errors (#251).
 *
 * D1 already retries read-only statements (SELECT / WITH / EXPLAIN) up to two
 * more times on its own, so a plain read rarely surfaces "Network connection
 * lost". Anything containing a write keyword is not retried by D1, even when it
 * is idempotent: `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`. That is
 * exactly what `ensureTables()` runs as the first statement on a cold isolate,
 * which is how a GET on /api/admin/registrations could 500 with
 * `D1_ERROR: Network connection lost.` despite every read on the route being
 * auto-retried.
 *
 * Only use this around work that is safe to run twice. It is not a general
 * wrapper for writes.
 *
 * Messages are Cloudflare's "Retry the operation" rows from
 * https://developers.cloudflare.com/d1/observability/debug-d1/#error-list —
 * overload, CPU and memory resets are deliberately absent, because retrying
 * those adds load to the thing that is already struggling.
 */

const TRANSIENT_D1_MESSAGES = [
  "Network connection lost",
  "Replica disconnected from primary",
  "storage caused object to be reset",
  "reset because its code was updated",
  "Cannot resolve D1 DB due to transient issue",
  "while starting up D1 DB storage caused object to be reset",
] as const;

/** Whether an error is one Cloudflare says to retry. Never throws. */
export function isTransientD1Error(err: unknown): boolean {
  let msg: string;
  try {
    msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  } catch {
    return false;
  }
  return TRANSIENT_D1_MESSAGES.some((m) => msg.includes(m));
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3, matching D1's own read retries. */
  attempts?: number;
  /** Base delay in ms, doubled per retry, with up to 50% jitter added. Default 50. */
  baseDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; returns [0, 1). */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying only on {@link isTransientD1Error}. Any other error, or
 * the last transient one, is rethrown unchanged so callers and the PostHog
 * middleware still see the original failure.
 */
export async function retryTransientD1<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 50;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientD1Error(err)) throw err;
      const delay = base * 2 ** (attempt - 1);
      await sleep(Math.round(delay + delay * 0.5 * random()));
    }
  }
}
