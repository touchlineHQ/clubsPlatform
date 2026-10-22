import type { D1Database } from "@cloudflare/workers-types";

/**
 * Failed Direct Debit collections (#77). GoCardless payment events don't change
 * a mandate's status, but the treasurer has to see a failure, so it is recorded
 * against the registration the mandate pays for and cleared when a later
 * collection on that mandate is confirmed or paid out.
 */

/** Payment actions that mean money arrived, clearing an earlier failure. */
const PAYMENT_SUCCESS_ACTIONS = new Set(['confirmed', 'paid_out']);

export async function recordPaymentOutcome(
  db: D1Database,
  action: string,
  paymentId: string,
  mandateId: string | null,
  cause: string | null,
  now: number,
): Promise<void> {
  if (!mandateId) return;
  if (action === 'failed') {
    // The mandate identifies the billing registration; one payment_failure row
    // per GoCardless payment, so a retried webhook or a re-failure updates it.
    await db
      .prepare(
        `INSERT INTO "payment_failure" (paymentId, clubSlug, registrationId, mandateId, cause, failedAt, resolvedAt)
         SELECT ?, pp."clubSlug", pp."registrationId", ?, ?, ?, NULL
           FROM "player_payment" pp
          WHERE pp."mandateId" = ?
          ORDER BY pp."updatedAt" DESC
          LIMIT 1
         ON CONFLICT ("paymentId") DO UPDATE SET
           cause = excluded.cause, failedAt = excluded.failedAt, resolvedAt = NULL`,
      )
      .bind(paymentId, mandateId, cause, now, mandateId)
      .run();
    return;
  }
  if (PAYMENT_SUCCESS_ACTIONS.has(action)) {
    await db
      .prepare(
        `UPDATE "payment_failure" SET resolvedAt = ?
          WHERE mandateId = ? AND resolvedAt IS NULL`,
      )
      .bind(now, mandateId)
      .run();
  }
}
