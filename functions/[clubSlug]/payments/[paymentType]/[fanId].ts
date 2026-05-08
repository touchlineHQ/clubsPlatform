import { ensureTables } from '../../../lib/ensure-tables';
import type { Env } from '../../../lib/api-helpers';
import { createGoCardlessLink } from '../../../lib/gocardless-link';

const ALLOWED_TYPES = new Set(['SUBS']);

/**
 * Public landing URL for a player to set up their team subscription.
 * Path: /<clubSlug>/payments/<paymentType>/<fanId>
 *
 * Currently restricted to paymentType=SUBS — the amount is derived from the
 * team's assigned subscription level. The endpoint creates a GoCardless billing
 * request and 302s the player to the hosted authorisation URL.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  await ensureTables(env.DB);

  const clubSlug = String(params.clubSlug ?? '');
  const paymentType = String(params.paymentType ?? '').toUpperCase();
  const fanId = String(params.fanId ?? '').trim();
  const origin = new URL(request.url).origin;

  if (!clubSlug || !paymentType || !fanId) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_url`, 302);
  }
  if (!ALLOWED_TYPES.has(paymentType)) {
    return Response.redirect(
      `${origin}/#/payment-cancelled?reason=unsupported_type&type=${encodeURIComponent(paymentType)}`,
      302,
    );
  }

  // Verify the club exists. If not, treat as not-found to avoid leaking info.
  const club = await env.DB
    .prepare(`SELECT slug FROM "club_config" WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ slug: string }>();
  if (!club) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=unknown_club`, 302);
  }

  // Find the player and their registration with an assigned subscription level.
  // If a player is on multiple teams in this club, we prefer the team with a
  // subscription level assigned. Otherwise we fall back to the first registration.
  const registration = await env.DB
    .prepare(
      `SELECT pr.id            AS registrationId,
              pr.teamName,
              p.fanId,
              sl.id             AS levelId,
              sl.yearlyPriceInPence,
              sl.intervalCount,
              sl.intervalUnit
         FROM player_registration pr
         JOIN player p ON p.id = pr.playerId
         LEFT JOIN team_subscription_level tsl
                ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
         LEFT JOIN subscription_level sl ON sl.id = tsl.subscriptionLevelId
        WHERE pr.clubSlug = ? AND p.fanId = ?
        ORDER BY (sl.id IS NULL) ASC, pr.createdAt ASC
        LIMIT 1`
    )
    .bind(clubSlug, fanId)
    .first<{
      registrationId: string;
      teamName: string;
      fanId: string;
      levelId: string | null;
      yearlyPriceInPence: number | null;
      intervalCount: number | null;
      intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
    }>();

  if (!registration) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=player_not_found`, 302);
  }

  if (
    !registration.levelId ||
    registration.yearlyPriceInPence == null ||
    registration.intervalCount == null ||
    registration.intervalUnit == null
  ) {
    return Response.redirect(
      `${origin}/#/payment-cancelled?reason=no_level&team=${encodeURIComponent(registration.teamName)}`,
      302,
    );
  }

  const perPaymentInPence = Math.round(
    registration.yearlyPriceInPence / Math.max(1, registration.intervalCount),
  );

  const result = await createGoCardlessLink({
    env,
    db: env.DB,
    clubSlug,
    registrationId: registration.registrationId,
    paymentType,
    amountInPence: perPaymentInPence,
    intervalUnit: registration.intervalUnit,
    count: registration.intervalCount,
    description: `${paymentType} subscription - FAN ${registration.fanId}`,
    origin,
  });

  if (!result.ok) {
    console.error('Public payment link failed:', result);
    return Response.redirect(
      `${origin}/#/payment-cancelled?reason=link_failed&code=${result.status}`,
      302,
    );
  }

  return Response.redirect(result.authorisationUrl, 302);
};
