import type { D1Database } from "@cloudflare/workers-types";

/**
 * Failed Direct Debit collections (#77). GoCardless payment events don't change
 * a mandate's status, but the treasurer has to see a failure, so it is recorded
 * against the registration the mandate pays for and cleared when a later
 * collection on that mandate is confirmed or paid out.
 *
 * GoCardless doesn't guarantee delivery order, so both transitions compare the
 * events' own times (created_at), not when they arrived: a success clears only
 * failures that happened before it, and the latest success per mandate is kept
 * in payment_success so a failure that arrives after a newer success is
 * recorded already resolved.
 */

/** Payment actions that mean money arrived, clearing an earlier failure. */
const PAYMENT_SUCCESS_ACTIONS = new Set(['confirmed', 'paid_out']);

export async function recordPaymentOutcome(
  db: D1Database,
  action: string,
  paymentId: string,
  mandateId: string | null,
  cause: string | null,
  eventAt: number,
  now: number,
): Promise<void> {
  if (!mandateId) return;
  if (action === 'failed') {
    // The mandate identifies the billing registration; one payment_failure row
    // per GoCardless payment, so a retried webhook or a re-failure updates it,
    // but an older event for the same payment can't overwrite a newer one.
    await db
      .prepare(
        `INSERT INTO "payment_failure" (paymentId, clubSlug, registrationId, mandateId, cause, failedAt, resolvedAt)
         SELECT ?, pp."clubSlug", pp."registrationId", ?, ?, ?,
                CASE WHEN EXISTS (SELECT 1 FROM "payment_success" ps
                                   WHERE ps."mandateId" = ? AND ps."lastSuccessAt" >= ?)
                     THEN ? END
           FROM "player_payment" pp
          WHERE pp."mandateId" = ?
          ORDER BY pp."updatedAt" DESC
          LIMIT 1
         ON CONFLICT ("paymentId") DO UPDATE SET
           cause = excluded.cause, failedAt = excluded.failedAt, resolvedAt = excluded.resolvedAt
         WHERE excluded.failedAt >= "payment_failure".failedAt`,
      )
      .bind(paymentId, mandateId, cause, eventAt, mandateId, eventAt, now, mandateId)
      .run();
    return;
  }
  if (PAYMENT_SUCCESS_ACTIONS.has(action)) {
    // Remember the success first, so a failure written concurrently either sees
    // it or is cleared by the update below.
    await db
      .prepare(
        `INSERT INTO "payment_success" (mandateId, lastSuccessAt) VALUES (?, ?)
         ON CONFLICT ("mandateId") DO UPDATE SET
           lastSuccessAt = MAX("payment_success".lastSuccessAt, excluded.lastSuccessAt)`,
      )
      .bind(mandateId, eventAt)
      .run();
    await db
      .prepare(
        `UPDATE "payment_failure" SET resolvedAt = ?
          WHERE mandateId = ? AND resolvedAt IS NULL AND failedAt <= ?`,
      )
      .bind(now, mandateId, eventAt)
      .run();
  }
}
