import { ensureTables } from '../../lib/ensure-tables';
import type { Env } from '../../lib/api-helpers';
import { getPostHog } from '../../lib/posthog';

/**
 * Public FAN entry page for a club's payment flow.
 * Path: /<clubSlug>/payments
 *
 * - GET: returns an HTML form where the player enters their FAN.
 * - POST: validates the FAN exists for this club and 303-redirects to
 *   /<clubSlug>/payments/SUBS/<fanId>, which handles single/multi-team
 *   resolution and the GoCardless redirect.
 *
 * On validation failure (unknown FAN, blank input) we re-render the form
 * with an error message rather than dumping the user on payment-cancelled.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  await ensureTables(env.DB);

  const clubSlug = String(params.clubSlug ?? '');
  const origin = new URL(request.url).origin;
  const error = new URL(request.url).searchParams.get('error');
  const submittedFan = new URL(request.url).searchParams.get('fan') ?? '';

  if (!clubSlug) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_url`, 302);
  }

  const club = await env.DB
    .prepare(`SELECT slug, name FROM "club_config" WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ slug: string; name: string }>();

  if (!club) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=unknown_club`, 302);
  }

  return new Response(formPage(club.name, clubSlug, submittedFan, error), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  await ensureTables(env.DB);

  const clubSlug = String(params.clubSlug ?? '');
  const origin = new URL(request.url).origin;

  if (!clubSlug) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_url`, 302);
  }

  let fanId = '';
  try {
    const form = await request.formData();
    fanId = String(form.get('fanId') ?? '').trim();
  } catch {
    return Response.redirect(`${origin}/${clubSlug}/payments?error=invalid`, 303);
  }

  if (!fanId) {
    return Response.redirect(`${origin}/${clubSlug}/payments?error=empty`, 303);
  }

  const club = await env.DB
    .prepare(`SELECT slug FROM "club_config" WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ slug: string }>();
  if (!club) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=unknown_club`, 302);
  }

  const player = await env.DB
    .prepare(
      `SELECT p.fanId
         FROM player p
         JOIN player_registration pr ON pr.playerId = p.id
        WHERE pr.clubSlug = ? AND p.fanId = ?
        LIMIT 1`
    )
    .bind(clubSlug, fanId)
    .first<{ fanId: string }>();

  if (!player) {
    const params = new URLSearchParams({ error: 'not_found', fan: fanId });
    return Response.redirect(`${origin}/${clubSlug}/payments?${params}`, 303);
  }

  const posthog = getPostHog(env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: fanId,
      event: 'payment fan entry submitted',
      properties: { club_slug: clubSlug, fan_id: fanId },
    });
  }

  return Response.redirect(
    `${origin}/${clubSlug}/payments/SUBS/${encodeURIComponent(fanId)}`,
    303,
  );
};

/** Generate the HTML form page for FAN entry. */
function formPage(
  clubName: string,
  clubSlug: string,
  submittedFan: string,
  error: string | null,
): string {
  const errorMessage = (() => {
    switch (error) {
      case 'not_found':
        return `We couldn't find a registration for FAN "${escHtml(submittedFan)}" at this club. Check the number and try again, or contact your club admin.`;
      case 'empty':
        return 'Please enter your FAN.';
      case 'invalid':
        return 'That form submission was invalid. Please try again.';
      default:
        return null;
    }
  })();

  const prefill = error === 'not_found' ? escAttr(submittedFan) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pay your subscription &mdash; ${escHtml(clubName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc; color: #1e293b; min-height: 100vh;
      display: flex; align-items: flex-start; justify-content: center; padding: 2rem 1rem;
    }
    .container { width: 100%; max-width: 460px; }
    .card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 1.75rem;
    }
    .club-name {
      color: #64748b; font-size: .8rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .05em; margin-bottom: .25rem;
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: .5rem; }
    .subtitle { color: #64748b; font-size: .9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: .4rem; }
    .help { color: #64748b; font-size: .8rem; margin-top: .35rem; }
    input[type="text"] {
      width: 100%; padding: .65rem .85rem; font-size: 1rem;
      border: 1px solid #cbd5e1; border-radius: 8px; background: #fff;
      font-family: inherit;
    }
    input[type="text"]:focus { outline: 2px solid #3b82f6; outline-offset: 1px; border-color: #3b82f6; }
    .btn {
      display: inline-block; width: 100%; margin-top: 1.25rem;
      background: #3b82f6; color: #fff; border: none; cursor: pointer;
      font-size: 1rem; font-weight: 600; font-family: inherit;
      padding: .7rem 1rem; border-radius: 999px;
    }
    .btn:hover { background: #2563eb; }
    .error {
      background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
      padding: .65rem .85rem; border-radius: 8px;
      font-size: .875rem; margin-bottom: 1rem; line-height: 1.45;
    }
    .footer { margin-top: 1.25rem; color: #94a3b8; font-size: .8rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="club-name">${escHtml(clubName)}</div>
      <h1>Pay your subscription</h1>
      <p class="subtitle">Enter your FAN (Football Association Number) to set up your subscription payment.</p>
      ${errorMessage ? `<div class="error" role="alert">${errorMessage}</div>` : ''}
      <form method="POST" action="/${escAttr(clubSlug)}/payments" novalidate>
        <label for="fanId">FAN</label>
        <input
          type="text"
          id="fanId"
          name="fanId"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          required
          value="${prefill}"
          placeholder="e.g. 12345678"
        />
        <p class="help">Your FAN is the number issued by The FA when you first registered as a player.</p>
        <button type="submit" class="btn">Continue</button>
      </form>
    </div>
    <p class="footer">If you don't know your FAN, contact your team manager or club admin.</p>
  </div>
</body>
</html>`;
}

/** Escape HTML special characters. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape HTML attribute special characters. */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
