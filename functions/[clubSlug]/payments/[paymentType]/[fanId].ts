import { ensureTables } from '../../../lib/ensure-tables';
import type { Env } from '../../../lib/api-helpers';
import { createGoCardlessLink } from '../../../lib/gocardless-link';
import { getPostHog, clubGroups } from '../../../lib/posthog';
import { SETTLED_STATUSES } from '../../../lib/payment-status';
import {
  billingRegistrationIdSql,
  subscriptionLevelJoinSql,
} from '../../../lib/registration-merge';

const ALLOWED_TYPES = new Set(['SUBS']);

/**
 * Which "already sorted" status wins when a registration carries several rows,
 * and what the selection page calls it. A live subscription outranks a finished
 * one so the pill describes what is happening now; a manual override ranks
 * lowest because it has no GoCardless subscription behind it, and badging one
 * "Subscription active" would tell the player something untrue.
 */
const SETTLED_STATUS_RANK: Record<string, number> = {
  active: 3,
  completed: 2,
  manual: 1,
};

const SETTLED_STATUS_LABEL: Record<string, string> = {
  active: 'Subscription active',
  completed: 'Paid in full',
  manual: 'Manually paid',
};

type RegistrationRow = {
  registrationId: string;
  /** The registration this one's money hangs off — itself, unless merged. */
  billingRegistrationId: string;
  teamName: string;
  fanId: string;
  levelId: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
  startDate: string | null;
};

/**
 * One billable thing: a registration, or a merged group of them. `registrationId`
 * is always the primary's — what the payment hangs off and what prices the group.
 */
type RegistrationGroup = Omit<RegistrationRow, 'billingRegistrationId'> & {
  teamNames: string[];
  memberIds: string[];
};

/**
 * Collapse rows into billable groups, keyed on the billing registration.
 *
 * A group takes the primary's row for everything but the team list, because that
 * is the registration the payment is created against. Input order is preserved,
 * so a group sorts where its first-seen member did.
 */
function groupRegistrations(rows: RegistrationRow[]): RegistrationGroup[] {
  const byBillingId = new Map<string, RegistrationGroup>();
  const primaries = new Map<string, RegistrationRow>();

  // Falls back to the row's own id: a null would key every registration to one
  // group and collapse unrelated teams into a single card.
  const billingIdOf = (row: RegistrationRow) => row.billingRegistrationId || row.registrationId;

  for (const row of rows) {
    if (row.registrationId === billingIdOf(row)) primaries.set(row.registrationId, row);
  }

  for (const row of rows) {
    const billingId = billingIdOf(row);
    const existing = byBillingId.get(billingId);

    if (existing) {
      existing.teamNames.push(row.teamName);
      existing.memberIds.push(row.registrationId);
      continue;
    }

    // A secondary can be seen first (the ORDER BY floats levelled rows), and
    // pricing a group off one is exactly the bug this avoids.
    const source = primaries.get(billingId) ?? row;
    byBillingId.set(billingId, {
      registrationId: billingId,
      teamName: source.teamName,
      fanId: source.fanId,
      levelId: source.levelId,
      yearlyPriceInPence: source.yearlyPriceInPence,
      intervalCount: source.intervalCount,
      intervalUnit: source.intervalUnit,
      startDate: source.startDate,
      teamNames: [row.teamName],
      memberIds: [row.registrationId],
    });
  }

  // Primary's team first, then the rest alphabetically, so the card is stable.
  for (const group of byBillingId.values()) {
    const others = group.teamNames.filter(t => t !== group.teamName).sort();
    group.teamNames = [group.teamName, ...others];
  }

  return [...byBillingId.values()];
}

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

  const { results: registrationRows } = await env.DB
    .prepare(
      // Level precedence lives in lib/registration-merge.ts; billingRegistrationId
      // is the registration this one's money hangs off.
      `SELECT pr.id            AS registrationId,
              ${billingRegistrationIdSql('pr')} AS billingRegistrationId,
              pr.teamName,
              p.fanId,
              sl.id             AS levelId,
              sl.yearlyPriceInPence,
              sl.intervalCount,
              sl.intervalUnit,
              sl.startDate
         FROM player_registration pr
         JOIN player p ON p.id = pr.playerId
         ${subscriptionLevelJoinSql('pr')}
        WHERE pr.clubSlug = ? AND p.fanId = ?
        ORDER BY (sl.id IS NULL) ASC, pr.teamName ASC`
    )
    .bind(clubSlug, fanId)
    .all<RegistrationRow>();

  // Merged registrations are one thing to pay for, so a player billed once sees
  // one card rather than an invitation to pay twice for the same subs.
  const registrations = groupRegistrations(registrationRows);

  if (registrations.length === 0) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=player_not_found`, 302);
  }

  const posthog = getPostHog(env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: fanId,
      event: 'payment page viewed',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        payment_type: paymentType,
        fan_id: fanId,
        registration_count: registrations.length,
      },
    });
  }

  // One group is one thing to pay for, however many registrations it spans.
  let registration: RegistrationGroup;

  if (registrations.length === 1 && !regParam) {
    registration = registrations[0];
  } else if (regParam) {
    // A pre-merge or exported link can name a secondary — resolve it forward
    // rather than calling it invalid; the player really does hold it.
    const match = registrations.find(r => r.memberIds.includes(regParam));
    if (!match) {
      return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_reg`, 302);
    }
    registration = match;
  } else {
    // Several groups, no ?reg= — show selection page
    return selectionPage(env.DB, clubSlug, fanId, registrations, origin, paymentType);
  }

  // Anything already collecting or already paid means the player is sorted, so
  // never send them into the mandate flow again. 'completed' is the one that
  // bites: a plan that has collected in full would otherwise be charged twice.
  //
  // Covers every member: an in-flight flow can have left a row on a secondary,
  // and that still means "do not charge again".
  const existingPayment = await env.DB
    .prepare(
      `SELECT reference FROM "player_payment"
        WHERE registrationId IN (${registration.memberIds.map(() => '?').join(', ')})
          AND status IN (${SETTLED_STATUSES.map(() => '?').join(', ')})
        LIMIT 1`
    )
    .bind(...registration.memberIds, ...SETTLED_STATUSES)
    .first<{ reference: string }>();

  if (existingPayment?.reference) {
    // Intentionally omit amount/interval_unit — the subscription level may have
    // changed since the player originally signed up, so the original amount is
    // the source of truth (held by GoCardless) and showing a different number
    // here would be misleading.
    const successParams = new URLSearchParams({
      ref: existingPayment.reference,
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
    startDate: registration.startDate,
    // Names every team, so the mandate page says what the payment is for.
    description: `${registration.teamNames.join(' + ')} subscription — FAN ${registration.fanId}`,
    origin,
  });

  if (!result.ok) {
    console.error('Public payment link failed:', result);
    // Map the underlying failure to a specific cancellation reason so the
    // player (and their club admin) can see what to fix instead of a generic
    // "link failed". `code` is kept for tail-end diagnostics.
    const reason =
      result.status === 503 ? 'token_missing' :
      result.status === 502 ? 'gocardless_error' :
      result.status === 404 ? 'player_not_found' :
      result.status === 400 ? 'invalid_link' :
      'link_failed';
    const params = new URLSearchParams({ reason, code: String(result.status) });
    if (result.detail) params.set('detail', result.detail.slice(0, 200));
    return Response.redirect(`${origin}/#/payment-cancelled?${params}`, 302);
  }

  return Response.redirect(result.authorisationUrl, 302);
};

/**
 * Renders an HTML page for players with several things to pay for.
 *
 * One card per billable *group*, not per registration, naming every team it
 * covers. Cards are disabled for groups with no level or already paid, by Direct
 * Debit or by an admin's manual override.
 */
async function selectionPage(
  db: D1Database,
  clubSlug: string,
  fanId: string,
  registrations: RegistrationGroup[],
  origin: string,
  paymentType: string,
): Promise<Response> {
  // Badging decides whether a card is offered, so it covers every member.
  const allMemberIds = registrations.flatMap(r => r.memberIds);
  const placeholders = allMemberIds.map(() => '?').join(',');
  const { results: existingPayments } = await db
    .prepare(
      `SELECT registrationId, status FROM "player_payment"
        WHERE registrationId IN (${placeholders})
          AND reference LIKE '%-SUBS%'`
    )
    .bind(...allMemberIds)
    .all<{ registrationId: string; status: string }>();

  // Every settled status disables the card; SETTLED_STATUS_RANK decides which
  // one the pill describes when a group carries more than one row.
  const paidStatusByRegistration = new Map<string, string>();
  for (const p of existingPayments) {
    const rank = SETTLED_STATUS_RANK[p.status];
    if (rank === undefined) continue;
    const current = paidStatusByRegistration.get(p.registrationId);
    if (current === undefined || rank > SETTLED_STATUS_RANK[current]) {
      paidStatusByRegistration.set(p.registrationId, p.status);
    }
  }

  /** The highest-ranked settled status anywhere in the group, if any. */
  const settledStatusForGroup = (group: RegistrationGroup): string | undefined => {
    let best: string | undefined;
    for (const id of group.memberIds) {
      const status = paidStatusByRegistration.get(id);
      if (status === undefined) continue;
      if (best === undefined || SETTLED_STATUS_RANK[status] > SETTLED_STATUS_RANK[best]) {
        best = status;
      }
    }
    return best;
  };

  const cards = registrations.map(r => {
    const hasLevel = r.levelId != null && r.yearlyPriceInPence != null;
    const paidStatus = settledStatusForGroup(r);
    const isSettled = paidStatus != null;
    const href = (hasLevel && !isSettled)
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

    // Say so on the card, or the payer wonders where their other team went.
    const teamLine = r.teamNames.length > 1
      ? `<div class="card-team">${escHtml(r.teamNames.join(' + '))}</div>
         <div class="card-merged">One payment covering ${r.teamNames.length} teams</div>`
      : `<div class="card-team">${escHtml(r.teamName)}</div>`;

    return `
    <div class="card${(hasLevel && !isSettled) ? '' : ' card--disabled'}">
      <div class="card-body">
        ${teamLine}
        ${amountText
          ? `<div class="card-amount">${escHtml(amountText)}</div>`
          : `<div class="card-no-level">No subscription level assigned — contact your club admin</div>`
        }
        ${isSettled ? `<span class="badge-active">${SETTLED_STATUS_LABEL[paidStatus!]}</span>` : ''}
      </div>
      ${href
        ? `<a class="btn" href="${escAttr(href)}">Set up payment</a>`
        : `<span class="btn btn--disabled">${isSettled ? 'Already set up' : 'Set up payment'}</span>`
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
    .card-merged { color: #64748b; font-size: .78rem; margin-top: .15rem; }
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

/**
 * Escapes a string for safe insertion into HTML text content.
 */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes a string for safe insertion into HTML attribute values.
 */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
