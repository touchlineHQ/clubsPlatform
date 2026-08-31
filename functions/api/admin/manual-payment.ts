import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from '../../lib/api-helpers';
import { getPostHog } from '../../lib/posthog';
import { writeAuditLog } from '../../lib/audit-log';
import { GC_BLOCKING_STATUSES } from '../../lib/payment-status';

/**
 * Manual payment override — an admin ticking a registration as paid for players
 * who pay outside GoCardless (cash at a match, bank transfer, sponsored place).
 *
 * The override is stored as an ordinary player_payment row so it flows through
 * every existing join and report, distinguished by:
 *
 *   status     'manual'
 *   mandateId  '' — the column is NOT NULL and a real GC mandate id is never
 *                   empty, so the webhook's `WHERE mandateId = ?` can never
 *                   match this row and flip it back
 *   reference  MANUAL-<TEAMNAME>-<fanId>-SUBS
 *
 * The `-SUBS` suffix keeps the row visible to the existing `reference LIKE
 * '%-SUBS%'` filters; the `MANUAL-` prefix keeps it clear of confirm.ts's
 * `<reference>-________` dedupe match.
 */

interface RegistrationRow {
  registrationId: string;
  teamName: string;
  fanId: string;
}

/**
 * Mirrors the logical reference built in lib/gocardless-link.ts, prefixed so a
 * manual row can never be mistaken for a GoCardless one. Deterministic on
 * purpose: re-marking a registration after an undo reuses the same row rather
 * than colliding with UNIQUE(clubSlug, reference).
 */
function manualReference(teamName: string, fanId: string): string {
  return `MANUAL-${teamName.replace(/\s+/g, '').toUpperCase()}-${fanId}-SUBS`;
}

/** Prevent a webhook-completed GoCardless row and a manual override coexisting. */
const NO_COMPLETED_GC_PAYMENT_SQL = `NOT EXISTS (
  SELECT 1 FROM "player_payment" AS gc
   WHERE gc.registrationId = ?
     AND gc.clubSlug = ?
     AND gc.status = 'completed'
     AND gc.mandateId != ''
)`;

/**
 * Load a registration's basic details for creating a manual payment reference.
 * Returns null if the registration doesn't exist or doesn't belong to the club.
 */
async function loadRegistration(
  db: D1Database,
  registrationId: string,
  clubSlug: string,
): Promise<RegistrationRow | null> {
  return db
    .prepare(
      `SELECT pr.id AS registrationId, pr.teamName, p.fanId
         FROM "player_registration" pr
         JOIN "player" p ON p.id = pr.playerId
        WHERE pr.id = ? AND pr.clubSlug = ?`
    )
    .bind(registrationId, clubSlug)
    .first<RegistrationRow>();
}

/**
 * POST handler — marks a registration's subscription as manually paid.
 *
 * Creates or updates a player_payment row with status 'manual' for players who pay
 * outside GoCardless. Returns 409 if a live or fully-paid GoCardless payment
 * already exists, or if the registration is already marked as paid.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const adminId = (result.session.user as Record<string, unknown>).id as string;

  if (!clubSlug) return json({ error: 'Missing X-Club-Slug header' }, { status: 400 });

  const body = await context.request.json<{ registrationId?: string; note?: string }>();
  if (!body.registrationId) return json({ error: 'registrationId required' }, { status: 400 });

  const note = body.note?.trim() || null;

  const registration = await loadRegistration(context.env.DB, body.registrationId, clubSlug);
  if (!registration) return json({ error: 'Registration not found' }, { status: 404 });

  // A manual override must never sit on top of a live GoCardless mandate or
  // subscription: the platform would show the player as paid up while
  // GoCardless carried on collecting. Deactivating the payment is not a way
  // around this — that only updates our DB, it does not cancel at GoCardless.
  // A completed plan is blocked too: the player has already paid in full.
  const gcPayment = await context.env.DB
    .prepare(
      `SELECT id, status FROM "player_payment"
        WHERE registrationId = ?
          AND clubSlug = ?
          AND status IN (${GC_BLOCKING_STATUSES.map(() => '?').join(',')})
          AND mandateId != ''
        LIMIT 1`
    )
    .bind(body.registrationId, clubSlug, ...GC_BLOCKING_STATUSES)
    .first<{ id: string; status: string }>();

  if (gcPayment) {
    return json(
      {
        error:
          gcPayment.status === 'completed'
            ? 'This registration has already been paid in full through GoCardless.'
            : 'This registration has a live GoCardless payment — a manual override '
              + 'cannot be applied while it is in place.',
        status: gcPayment.status,
      },
      { status: 409 },
    );
  }

  const reference = manualReference(registration.teamName, registration.fanId);
  const now = nowMs();

  // Keyed on registrationId so an undo-then-remark reuses the row rather than
  // colliding with UNIQUE(clubSlug, reference), and scoped to `mandateId = ''`
  // so only a manual row is ever reused. A spent GoCardless row (cancelled or
  // failed) sits on the same registration and passes the live guard above;
  // reusing it would rewrite its reference while leaving its mandateId in
  // place, and the webhook's `WHERE mandateId = ?` would then flip the
  // override straight back off.
  const existing = await context.env.DB
    .prepare(
      `SELECT id, status FROM "player_payment"
        WHERE clubSlug = ? AND registrationId = ? AND mandateId = ''
        ORDER BY updatedAt DESC
        LIMIT 1`
    )
    .bind(clubSlug, body.registrationId)
    .first<{ id: string; status: string }>();

  if (existing?.status === 'manual') {
    return json({ error: 'Already marked as paid' }, { status: 409 });
  }

  let paymentId: string;
  let oldStatus: string | null;

  // Both writes below are conditional, and a no-op means a concurrent request
  // or GoCardless webhook got there first. The reads above cannot stand in for
  // that: two admins marking the same player at once would otherwise both see
  // the pre-state, both write 'manual', and both write an audit event — or,
  // with no row to reuse, the second insert would break UNIQUE(clubSlug,
  // reference) and 500 instead of returning the documented 409. The NOT EXISTS
  // predicate also closes the window for a webhook to mark a GC row completed.
  if (existing) {
    // Re-marking after an undo — reuse the registration's own manual row.
    paymentId = existing.id;
    oldStatus = existing.status;
    const update = await context.env.DB
      .prepare(
        `UPDATE "player_payment"
            SET reference = ?, status = 'manual', updatedAt = ?
          WHERE id = ? AND status != 'manual'
            AND ${NO_COMPLETED_GC_PAYMENT_SQL}`
      )
      .bind(reference, now, paymentId, body.registrationId, clubSlug)
      .run();
    if (update.meta.changes === 0) {
      return json({ error: 'Already marked as paid' }, { status: 409 });
    }
  } else {
    paymentId = randomId('pay');
    oldStatus = null;
    const insert = await context.env.DB
      .prepare(
        `INSERT INTO "player_payment"
           (id, clubSlug, registrationId, reference, mandateId, subscriptionId,
            status, createdAt, updatedAt)
         SELECT ?, ?, ?, ?, '', NULL, 'manual', ?, ?
          WHERE ${NO_COMPLETED_GC_PAYMENT_SQL}
         ON CONFLICT(clubSlug, reference) DO NOTHING`
      )
      .bind(
        paymentId,
        clubSlug,
        body.registrationId,
        reference,
        now,
        now,
        body.registrationId,
        clubSlug,
      )
      .run();
    if (insert.meta.changes === 0) {
      return json({ error: 'Already marked as paid' }, { status: 409 });
    }
  }

  await writeAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: 'manual_paid',
    targetTable: 'player_payment',
    targetId: paymentId,
    oldStatus,
    newStatus: 'manual',
    note,
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment manually marked paid',
      properties: {
        club_slug: clubSlug,
        payment_id: paymentId,
        registration_id: body.registrationId,
        fan_id: registration.fanId,
      },
    });
  }

  return json({
    ok: true,
    paymentId,
    manualPaidAt: now,
    manualPaidBy: (result.session.user as Record<string, unknown>).email ?? null,
    manualNote: note,
  });
};

/**
 * DELETE handler — removes a manual payment override.
 *
 * Sets the manual payment status to 'inactive'. Only affects payments with status
 * 'manual', so it can never deactivate a GoCardless payment. Returns 404 if no
 * manual payment is found for the registration.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const adminId = (result.session.user as Record<string, unknown>).id as string;

  if (!clubSlug) return json({ error: 'Missing X-Club-Slug header' }, { status: 400 });

  const registrationId = new URL(context.request.url).searchParams.get('registrationId');
  if (!registrationId) return json({ error: 'registrationId required' }, { status: 400 });

  // Scoped to status 'manual' so this can never deactivate a GoCardless payment.
  const manual = await context.env.DB
    .prepare(
      `SELECT id FROM "player_payment"
        WHERE registrationId = ? AND clubSlug = ? AND status = 'manual'
        LIMIT 1`
    )
    .bind(registrationId, clubSlug)
    .first<{ id: string }>();

  if (!manual) return json({ error: 'No manual payment to remove' }, { status: 404 });

  await context.env.DB
    .prepare(`UPDATE "player_payment" SET status = 'inactive', updatedAt = ? WHERE id = ?`)
    .bind(nowMs(), manual.id)
    .run();

  await writeAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: 'manual_paid_removed',
    targetTable: 'player_payment',
    targetId: manual.id,
    oldStatus: 'manual',
    newStatus: 'inactive',
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment manual override removed',
      properties: {
        club_slug: clubSlug,
        payment_id: manual.id,
        registration_id: registrationId,
      },
    });
  }

  return json({ ok: true });
};
