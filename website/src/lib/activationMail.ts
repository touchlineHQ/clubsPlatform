/**
 * Client drivers for activation mail (#132).
 *
 * The server caps each call to stay under the D1 Free query limit, so the
 * client repeats. A provider failure is reported in the totals and never
 * throws: it must not turn a good import into an error.
 */

export interface ActivationTotals {
  /** False when the platform has no mail provider configured. */
  configured: boolean;
  sent: number;
  failed: number;
  /** Still unsent after the loop stopped (a failure or the safety cap). */
  remaining: number;
}

interface SendResponse {
  configured: boolean;
  sent: number;
  failed: number;
  remaining: number;
}

const MAX_BATCHES = 100;

/** Send activation mail for every pending, not-yet-mailed contact. */
export async function sendPendingActivationMail(clubSlug: string): Promise<ActivationTotals> {
  const totals: ActivationTotals = { configured: true, sent: 0, failed: 0, remaining: 0 };
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await fetch('/api/admin/activation-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ action: 'send' }),
      });
      if (!res.ok) {
        totals.failed += 1;
        return totals;
      }
      const data = await res.json() as SendResponse;
      totals.configured = data.configured;
      totals.sent += data.sent;
      totals.failed += data.failed;
      totals.remaining = data.remaining;
      // Failed contacts are retried by the next call, so stop on any failure
      // rather than looping on the same rows.
      if (!data.configured || data.failed > 0 || data.remaining === 0) return totals;
    }
  } catch {
    totals.failed += 1;
  }
  return totals;
}

export interface SweepTotals {
  remindersSent: number;
  lapsed: number;
}

/** Send the one reminder and delete lapsed pending contacts. Best-effort. */
export async function sweepUnactivatedContacts(clubSlug: string): Promise<SweepTotals> {
  const totals: SweepTotals = { remindersSent: 0, lapsed: 0 };
  try {
    // One call deletes a capped chunk; keep going until nothing lapsed remains.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await fetch('/api/admin/activation-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ action: 'sweep' }),
      });
      if (!res.ok) return totals;
      const data = await res.json() as {
        reminders: { sent: number };
        lapsed: number;
        lapsedRemaining: number;
      };
      totals.remindersSent += data.reminders.sent;
      totals.lapsed += data.lapsed;
      if (!data.lapsedRemaining || data.lapsed === 0) return totals;
    }
  } catch {
    // Housekeeping retries on the next visit.
  }
  return totals;
}
