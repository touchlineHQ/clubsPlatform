import { clubGroups, getPostHog } from "./posthog";

/**
 * Sampled read-cost telemetry for the registrations reads.
 *
 * #120 added this for `/api/my-registrations`, whose club-wide scan was the
 * suspect in #107. #114 then moved that scan to the paginated admin endpoints
 * and the instrumentation did not follow, so the expensive reads left the one
 * place that was watching them. Worse, the old trigger went dead in the move:
 * `my-registrations` now passes `club: 0`, so its large-club arm could never
 * fire again. This module is that measurement put back where the work is, and
 * shared so the next endpoint cannot quietly skip it.
 *
 * **`rows_read`, not just elapsed time.** D1 bills and limits on rows read, and
 * it is the number that actually distinguishes the two shapes: the old club
 * scan read 7,495 rows to return 725, the paginated read reads ~102 to return
 * 51. Wall clock conflates that with network and contention; `meta.rows_read`
 * does not. Both are sampled, because a slow read that touches few rows is a
 * different problem worth seeing.
 */

/** Total wall clock past which a read is worth recording. */
export const SLOW_READ_MS = 250;

/**
 * Rows read past which a read is worth recording regardless of speed.
 *
 * A page is 50 rows and reads about double that. A club-wide aggregate reads
 * the filtered set by design. 1,000 is comfortably above both and well below
 * the scan this work removed, so it fires when a read starts behaving like the
 * thing we deleted rather than merely being large.
 */
export const ROWS_READ_SAMPLE = 1000;

/** The D1 fields this reads. Narrow on purpose — `meta` is untyped elsewhere. */
export interface D1ReadMeta {
  rows_read?: number;
  duration?: number;
}

export interface ReadCostSample {
  /** Which read this was, e.g. `registrations_page`. Becomes a property. */
  endpoint: string;
  /** Wall clock around the read, in ms. */
  ms: number;
  /** D1's own count, when the caller has a result to take it from. */
  rowsRead?: number;
  /** What the caller is handing back, for the read-to-returned ratio. */
  rowsReturned?: number;
  /** Endpoint-specific numbers. Counts and durations only — never identifiers. */
  extra?: Record<string, number | string | boolean | null>;
  /**
   * This read's own rows-read trigger, where {@link ROWS_READ_SAMPLE} does not
   * fit. Per-endpoint rather than a higher global figure: a read that groups the
   * club by design sits above the page-shaped threshold from its first request,
   * and a sampler that captures every call is not a sampler. The caller
   * documents its number; the default stays the one the pages are held to.
   */
  rowsReadSample?: number;
}

/**
 * Whether this read is worth a capture.
 *
 * Exported so the decision can be tested without a PostHog client, and so the
 * thresholds are asserted rather than described.
 */
export function shouldSample(sample: ReadCostSample): boolean {
  return (
    sample.ms >= SLOW_READ_MS ||
    (sample.rowsRead ?? 0) >= (sample.rowsReadSample ?? ROWS_READ_SAMPLE)
  );
}

/** Pulls D1's counters off a result, tolerating a driver that omits them. */
export function readMeta(result: { meta?: D1ReadMeta } | null | undefined): D1ReadMeta {
  return result?.meta ?? {};
}

/**
 * Records what a read cost, for the reads that cost something.
 *
 * Deliberately not on every request, and the reason is the same one #120 gave:
 * the Workers Free plan allows 10ms of CPU per request (see `lib/auth.ts` and
 * `api/admin/import-players.ts`, both already shaped around it). Serialising a
 * capture is CPU and sending it is a subrequest, so charging every healthy read
 * for them would push the requests we are diagnosing closer to the edge they
 * are being measured against. Sampling the expensive ones costs the healthy
 * path nothing.
 *
 * Sent through `waitUntil`, so it is off the response path entirely, and a
 * capture that fails is logged rather than surfaced — telemetry must never turn
 * a working read into a failed one.
 *
 * Counts and durations only. No FAN numbers, no emails, no team names.
 */
export function reportReadCost(
  context: { env: Parameters<typeof getPostHog>[0]; waitUntil: (p: Promise<unknown>) => void },
  userId: string,
  clubSlug: string,
  sample: ReadCostSample,
): void {
  if (!shouldSample(sample)) return;

  const posthog = getPostHog(context.env);
  if (!posthog) return;

  context.waitUntil(
    posthog
      .captureImmediate({
        distinctId: userId,
        event: "registrations read",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          endpoint: sample.endpoint,
          total_ms: sample.ms,
          ...(sample.rowsRead === undefined ? {} : { rows_read: sample.rowsRead }),
          ...(sample.rowsReturned === undefined ? {} : { rows_returned: sample.rowsReturned }),
          ...sample.extra,
        },
      })
      .catch((err) => console.error("PostHog capture failed", err)),
  );
}
