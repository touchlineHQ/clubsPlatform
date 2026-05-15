import { ensureTables } from '../../../lib/ensure-tables';
import type { Env } from '../../../lib/api-helpers';
import { createGoCardlessLink } from '../../../lib/gocardless-link';

const ALLOWED_TYPES = new Set(['SUBS']);

type RegistrationRow = {
  registrationId: string;
  teamName: string;
  fanId: string;
  levelId: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
};

/**
 * Public landing URL for a player to set up their team subscription.
 * Path: /<clubSlug>/payments/<paymentType>/<fanId>[?reg=<registrationId>]
 *
 * - Single-team player: redirects straight to GoCardless.
 * - Multi-team player (no ?reg=): returns an HTML team-selection page.
 * - Multi-team player with ?reg=: validates the registration belongs to this
 *   fanId/clubSlug then redirects to GoCardless for that specific registration.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  await ensureTables(env.DB);

  const clubSlug = String(params.clubSlug ?? '');
  const paymentType = String(params.paymentType ?? '').toUpperCase();
  const fanId = String(params.fanId ?? '').trim();
  const origin = new URL(request.url).origin;
  const regParam = new URL(request.url).searchParams.get('reg')?.trim() ?? null;

  if (!clubSlug || !paymentType || !fanId) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_url`, 302);
  }
  if (!ALLOWED_TYPES.has(paymentType)) {
    return Response.redirect(
      `${origin}/#/payment-cancelled?reason=unsupported_type&type=${encodeURIComponent(paymentType)}`,
      302,
    );
  }

  const club = await env.DB
    .prepare(`SELECT slug FROM "club_config" WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ slug: string }>();
  if (!club) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=unknown_club`, 302);
  }

  const { results: registrations } = await env.DB
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
         LEFT JOIN team_status_subscription_level tssl
                ON tssl.clubSlug = pr.clubSlug
               AND tssl.teamName = pr.teamName
               AND tssl.registrationStatus = pr.registrationStatus
         LEFT JOIN status_subscription_level ssl
                ON ssl.clubSlug = pr.clubSlug
               AND ssl.registrationStatus = pr.registrationStatus
         LEFT JOIN team_subscription_level tsl
                ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
         LEFT JOIN subscription_level sl
                ON sl.id = COALESCE(tssl.subscriptionLevelId, ssl.subscriptionLevelId, tsl.subscriptionLevelId)
        WHERE pr.clubSlug = ? AND p.fanId = ?
        ORDER BY (sl.id IS NULL) ASC, pr.teamName ASC`
    )
    .bind(clubSlug, fanId)
    .all<RegistrationRow>();

  if (registrations.length === 0) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=player_not_found`, 302);
  }

  // Resolve which registration to use
  let registration: RegistrationRow;

  if (registrations.length === 1 && !regParam) {
    registration = registrations[0];
  } else if (regParam) {
    const match = registrations.find(r => r.registrationId === regParam);
    if (!match) {
      return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_reg`, 302);
    }
    registration = match;
  } else {
    // Multiple registrations, no ?reg= — show selection page
    return selectionPage(env.DB, clubSlug, fanId, registrations, origin, paymentType);
  }

  const existingPayment = await env.DB
    .prepare(
      `SELECT reference FROM "player_payment"
        WHERE registrationId = ? AND status = 'active'
        LIMIT 1`
    )
    .bind(registration.registrationId)
    .first<{ reference: string }>();

  if (existingPayment?.reference) {
    const intervalUnit = registration.intervalUnit ?? 'monthly';
    const perPaymentInPence =
      registration.yearlyPriceInPence != null && registration.intervalCount != null
        ? Math.round(registration.yearlyPriceInPence / Math.max(1, registration.intervalCount))
        : 0;
    const successParams = new URLSearchParams({
      ref: existingPayment.reference,
      amount: String(perPaymentInPence),
      interval_unit: intervalUnit,
      existing: '1',
    });
    return Response.redirect(`${origin}/#/payment-success?${successParams}`, 302);
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
    description: `${registration.teamName} subscription — FAN ${registration.fanId}`,
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

async function selectionPage(
  db: D1Database,
  clubSlug: string,
  fanId: string,
  registrations: RegistrationRow[],
  origin: string,
  paymentType: string,
): Promise<Response> {
  // Check for already-active payments so we can badge them
  const placeholders = registrations.map(() => '?').join(',');
  const { results: existingPayments } = await db
    .prepare(
      `SELECT registrationId, status FROM "player_payment"
        WHERE registrationId IN (${placeholders})
          AND reference LIKE '%-SUBS%'`
    )
    .bind(...registrations.map(r => r.registrationId))
    .all<{ registrationId: string; status: string }>();

  const activeRegistrationIds = new Set(
    existingPayments
      .filter(p => p.status === 'active')
      .map(p => p.registrationId)
  );

  const cards = registrations.map(r => {
    const hasLevel = r.levelId != null && r.yearlyPriceInPence != null;
    const isActive = activeRegistrationIds.has(r.registrationId);
    const href = (hasLevel && !isActive)
      ? `${origin}/${clubSlug}/payments/${paymentType}/${fanId}?reg=${encodeURIComponent(r.registrationId)}`
      : null;

    const amountText = hasLevel
      ? (() => {
          const pence = Math.round(r.yearlyPriceInPence! / Math.max(1, r.intervalCount!));
          const pounds = (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
          const freq = r.intervalUnit === 'weekly' ? 'week' : r.intervalUnit === 'yearly' ? 'year' : 'month';
          const count = r.intervalCount && r.intervalCount > 1 ? `, ${r.intervalCount} payments` : '';
          return `${pounds} / ${freq}${count}`;
        })()
      : null;

    return `
    <div class="card${(hasLevel && !isActive) ? '' : ' card--disabled'}">
      <div class="card-body">
        <div class="card-team">${escHtml(r.teamName)}</div>
        ${amountText
          ? `<div class="card-amount">${escHtml(amountText)}</div>`
          : `<div class="card-no-level">No subscription level assigned — contact your club admin</div>`
        }
        ${isActive ? `<span class="badge-active">Subscription active</span>` : ''}
      </div>
      ${href
        ? `<a class="btn" href="${escAttr(href)}">Set up payment</a>`
        : `<span class="btn btn--disabled">${isActive ? 'Already set up' : 'Set up payment'}</span>`
      }
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Set up your subscription</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc; color: #1e293b; min-height: 100vh;
      display: flex; align-items: flex-start; justify-content: center; padding: 2rem 1rem;
    }
    .container { width: 100%; max-width: 480px; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: .25rem; }
    .subtitle { color: #64748b; font-size: .9rem; margin-bottom: 1.5rem; }
    .card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
      padding: 1rem; margin-bottom: .75rem;
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    }
    .card--disabled { opacity: .55; }
    .card-body { flex: 1; min-width: 0; }
    .card-team { font-weight: 600; font-size: 1rem; }
    .card-amount { color: #475569; font-size: .875rem; margin-top: .2rem; }
    .card-no-level { color: #94a3b8; font-size: .8rem; margin-top: .2rem; font-style: italic; }
    .badge-active {
      display: inline-block; margin-top: .35rem;
      background: #dcfce7; color: #166534;
      font-size: .7rem; font-weight: 600; padding: .15rem .5rem; border-radius: 999px;
    }
    .btn {
      flex-shrink: 0; display: inline-block;
      background: #3b82f6; color: #fff; text-decoration: none;
      font-size: .875rem; font-weight: 600;
      padding: .5rem 1rem; border-radius: 999px;
      white-space: nowrap;
    }
    .btn--disabled { background: #cbd5e1; color: #fff; cursor: not-allowed; }
    .footer { margin-top: 1.5rem; color: #94a3b8; font-size: .8rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Set up your subscription</h1>
    <p class="subtitle">FAN ${escHtml(fanId)} &mdash; choose a team to pay for</p>
    ${cards}
    <p class="footer">If you only play for one team, ask your club admin for a direct payment link.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
