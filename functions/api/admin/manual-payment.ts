import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from '../../lib/api-helpers';
import { getPostHog } from '../../lib/posthog';
import { writeAuditLog } from '../../lib/audit-log';

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

/** Statuses that mean GoCardless is still holding a live mandate or subscription. */
const LIVE_GC_STATUSES = ['active', 'mandate_only'];

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
 * outside GoCardless. Returns 409 if a live GoCardless payment already exists or
 * if the registration is already marked as paid.
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
  const liveGcPayment = await context.env.DB
    .prepare(
      `SELECT id, status FROM "player_payment"
        WHERE registrationId = ?
          AND clubSlug = ?
          AND status IN (${LIVE_GC_STATUSES.map(() => '?').join(',')})
          AND mandateId != ''
        LIMIT 1`
    )
    .bind(body.registrationId, clubSlug, ...LIVE_GC_STATUSES)
    .first<{ id: string; status: string }>();

  if (liveGcPayment) {
    return json(
      {
        error:
          'This registration has a live GoCardless payment — a manual override '
          + 'cannot be applied while it is in place.',
        status: liveGcPayment.status,
      },
      { status: 409 },
    );
  }

  const reference = manualReference(registration.teamName, registration.fanId);
  const now = nowMs();

  const existing = await context.env.DB
    .prepare(`SELECT id, status FROM "player_payment" WHERE clubSlug = ? AND reference = ?`)
    .bind(clubSlug, reference)
    .first<{ id: string; status: string }>();

  if (existing?.status === 'manual') {
    return json({ error: 'Already marked as paid' }, { status: 409 });
  }

  let paymentId: string;
  let oldStatus: string | null;

  if (existing) {
    // Re-marking after an undo — reuse the row rather than colliding with
    // UNIQUE(clubSlug, reference).
    paymentId = existing.id;
    oldStatus = existing.status;
    await context.env.DB
      .prepare(`UPDATE "player_payment" SET status = 'manual', updatedAt = ? WHERE id = ?`)
      .bind(now, paymentId)
      .run();
  } else {
    paymentId = randomId('pay');
    oldStatus = null;
    await context.env.DB
      .prepare(
        `INSERT INTO "player_payment"
           (id, clubSlug, registrationId, reference, mandateId, subscriptionId,
            status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, '', NULL, 'manual', ?, ?)`
      )
      .bind(paymentId, clubSlug, body.registrationId, reference, now, now)
      .run();
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
