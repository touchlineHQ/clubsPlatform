/**
 * Helper to resolve GoCardless resource IDs to fanId for PostHog identity stitching.
 * 
 * This ensures backend/webhook events use the same distinctId as frontend events,
 * allowing PostHog to stitch together the full payment journey funnel.
 */

/**
 * Look up the fanId associated with a GoCardless mandate or subscription.
 * Returns null if not found (e.g., legacy data, or event for unknown resource).
 */
export async function resolveFanIdFromGCResource(
  db: D1Database,
  mandateId: string | null,
  subscriptionId: string | null,
): Promise<string | null> {
  if (!mandateId && !subscriptionId) return null;

  const conditions: string[] = [];
  const bindings: (string | null)[] = [];

  if (mandateId) {
    conditions.push('pp.mandateId = ?');
    bindings.push(mandateId);
  }
  if (subscriptionId) {
    conditions.push('pp.subscriptionId = ?');
    bindings.push(subscriptionId);
  }

  const result = await db
    .prepare(
      `SELECT p.fanId
       FROM player_payment pp
       JOIN player_registration pr ON pr.id = pp.registrationId
       JOIN player p ON p.id = pr.playerId
       WHERE ${conditions.join(' OR ')}
       LIMIT 1`
    )
    .bind(...bindings)
    .first<{ fanId: string }>();

  return result?.fanId ?? null;
}

/**
 * Look up the fanId from a registrationId.
 * Used in confirm.ts where we already have the registrationId from GC metadata.
 */
export async function resolveFanIdFromRegistration(
  db: D1Database,
  registrationId: string,
): Promise<string | null> {
  const result = await db
    .prepare(
      `SELECT p.fanId
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       WHERE pr.id = ?
       LIMIT 1`
    )
    .bind(registrationId)
    .first<{ fanId: string }>();

  return result?.fanId ?? null;
}
