import { ensureTables } from "../lib/ensure-tables";
import { type Env, json } from "../lib/api-helpers";
import { getPostHog, clubGroups } from "../lib/posthog";
import {
  requestIp,
  withdrawMarketingConsentByToken,
} from "../lib/consent";
import {
  markUnsubscribeTokenUsed,
  purgeFromUnsubscribe,
  resolveUnsubscribeToken,
  withdrawContact,
  type ResolvedUnsubscribe,
  type UnsubscribeAction,
} from "../lib/unsubscribe";

/**
 * One-click unsubscribe (#135).
 *
 * GET  /api/unsubscribe?token=…  — preference page. Changes nothing: mail
 *      scanners and link previews fetch GET links.
 * POST /api/unsubscribe?token=…  — RFC 8058 one-click (body
 *      `List-Unsubscribe=One-Click`) withdraws the purpose of that mail, or a
 *      form post with `action` = marketing | all | purge.
 *
 * No login, no typing. An expired or already-used link still opens a working
 * page and can still withdraw — only the purge needs a fresh link, because it
 * is the one action a forwarded old email should not be able to take.
 * Unknown tokens get the same page as known ones, so the route reveals nothing.
 */

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ParsedRequest = { token: string; action: string; oneClick: boolean };

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const url = new URL(request.url);
  let token = url.searchParams.get("token")?.trim() ?? "";
  let action = "";
  let oneClick = false;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/x-www-form-urlencoded")
      || contentType.includes("multipart/form-data")
    ) {
      const form = await request.clone().formData();
      if (!token) token = String(form.get("token") ?? "").trim();
      action = String(form.get("action") ?? "").trim();
      oneClick = String(form.get("List-Unsubscribe") ?? "").trim() === "One-Click";
    }
  }
  return { token, action, oneClick };
}

function page(title: string, bodyHtml: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<main style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
${bodyHtml}
</main></body></html>`,
    { status, headers: PAGE_HEADERS },
  );
}

const BUTTON = "display:block;width:100%;margin:0 0 8px;padding:12px;border-radius:999px;border:1px solid #1a1a1a;font-size:15px;font-weight:600;cursor:pointer;";

function actionForm(token: string, action: UnsubscribeAction, label: string, help: string, primary = false): string {
  const colours = primary ? "background:#1a1a1a;color:#fff;" : "background:#fff;color:#1a1a1a;";
  return `<form method="post" style="margin:0 0 20px;">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <input type="hidden" name="action" value="${action}">
  <button type="submit" style="${BUTTON}${colours}">${escapeHtml(label)}</button>
  <p style="margin:0;font-size:13px;color:#555;">${escapeHtml(help)}</p>
</form>`;
}

function kindLabel(purpose: string): string {
  if (purpose === "marketing") return "club news and offers (marketing)";
  if (purpose === "operational") return "a club admin message (fixtures, safety, team updates)";
  return "a service message";
}

function preferencePage(token: string, resolved: ResolvedUnsubscribe, notice = ""): Response {
  const club = escapeHtml(resolved.clubName);
  const head = `<h1 style="margin:0 0 8px;font-size:20px;">${club}</h1>`;
  const noticeHtml = notice
    ? `<p role="status" style="margin:0 0 20px;padding:12px;border-radius:8px;background:#eef7ee;font-size:15px;">${escapeHtml(notice)}</p>`
    : "";

  if (!resolved.contact) {
    return page(
      `${resolved.clubName} email preferences`,
      `${head}${noticeHtml}<p style="font-size:15px;line-height:1.5;">This email address has been removed from ${club}. Nothing more will be sent to it.</p>`,
    );
  }

  const c = resolved.contact;
  const allStopped = c.state === "withdrawn" || c.state === "bounced";
  const status = allStopped
    ? `You won't get any more email from ${club}.`
    : c.marketingOptIn === 1
      ? `You currently get club admin messages and club news and offers from ${club}.`
      : `You currently get club admin messages from ${club}, but not club news and offers.`;

  const options: string[] = [];
  if (!allStopped && c.marketingOptIn === 1) {
    options.push(actionForm(token, "marketing", "Stop club news and offers",
      "You'll still get fixture changes, cancellations and safety messages.", true));
  }
  if (!allStopped) {
    options.push(actionForm(token, "all", "Stop all email from this club",
      "Includes fixture changes and safety messages. The club may then need to reach you another way.",
      c.marketingOptIn !== 1));
  }
  options.push(
    resolved.fresh
      ? actionForm(token, "purge", "Remove my email address entirely",
          "Deletes this address from the club's records. It won't be added back unless the club asks you again.")
      : `<p style="margin:0 0 20px;font-size:13px;color:#555;">To remove your email address entirely, use the link in a more recent email from ${club}, or ask the club to remove it.</p>`,
  );

  return page(
    `${resolved.clubName} email preferences`,
    `${head}<p style="margin:0 0 20px;font-size:13px;color:#555;">The email you came from was ${escapeHtml(kindLabel(resolved.purpose))}.</p>
${noticeHtml}<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${status}</p>
${options.join("\n")}
<p style="margin:0;font-size:12px;color:#777;">One click is enough — you don't need to log in. ${club} sends this email; it uses Touchline to do so.</p>`,
  );
}

/** The page an unknown (or legacy marketing) token gets. Same shape either way. */
function legacyPage(token: string): Response {
  return page(
    "Unsubscribe",
    `<h1 style="margin:0 0 16px;font-size:20px;">Unsubscribe from marketing emails</h1>
<p style="font-size:15px;line-height:1.5;">Click the button to confirm you no longer want marketing emails.</p>
<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit" style="${BUTTON}background:#1a1a1a;color:#fff;">Unsubscribe</button></form>`,
  );
}

function parseAction(raw: string): UnsubscribeAction | null {
  return raw === "marketing" || raw === "all" || raw === "purge" ? raw : null;
}

async function capture(
  context: EventContext<Env, string, unknown>,
  clubSlug: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const posthog = getPostHog(context.env);
  if (!posthog) return;
  context.waitUntil(
    posthog
      .captureImmediate({
        distinctId: `club:${clubSlug}`,
        event: "contact unsubscribed",
        ...clubGroups(clubSlug),
        // Scope and route only: no contact id, FAN, token or address.
        properties: { club_slug: clubSlug, ...properties },
      })
      .catch((err) => console.error("PostHog capture failed", err)),
  );
}

/** Pre-#135 marketing-consent tokens keep working. Quiet either way. */
async function legacyWithdraw(context: EventContext<Env, string, unknown>, token: string): Promise<Response> {
  const result = await withdrawMarketingConsentByToken(
    context.env.DB,
    token,
    requestIp(context.request),
  );
  if (!result.ok) return json({ ok: true, withdrawn: false });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: `consent:${result.subjectId}`,
      event: "marketing consent withdrawn",
      ...clubGroups(result.clubSlug),
      properties: {
        club_slug: result.clubSlug,
        subject_id: result.subjectId,
        source: "unsubscribe_link",
      },
    });
  }
  return json({ ok: true, withdrawn: true });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { token } = await parseRequest(context.request);
  if (!token) return json({ error: "token is required" }, { status: 400 });
  await ensureTables(context.env.DB);
  const resolved = await resolveUnsubscribeToken(context.env.DB, token);
  if (!resolved) return legacyPage(token);
  return preferencePage(token, resolved);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { token, action: rawAction, oneClick } = await parseRequest(context.request);
  if (!token) return json({ error: "token is required" }, { status: 400 });
  await ensureTables(context.env.DB);
  const db = context.env.DB;

  const resolved = await resolveUnsubscribeToken(db, token);
  if (!resolved) return legacyWithdraw(context, token);

  // RFC 8058 one-click withdraws the purpose of the mail it came from:
  // marketing mail stops marketing; admin mail stops all club mail.
  const action: UnsubscribeAction | null = oneClick
    ? (resolved.purpose === "marketing" ? "marketing" : "all")
    : parseAction(rawAction);
  if (!action) return preferencePage(token, resolved);

  if (!resolved.contact) {
    return oneClick
      ? new Response("Unsubscribed", { headers: { "Content-Type": "text/plain" } })
      : preferencePage(token, resolved);
  }

  if (action === "purge") {
    if (!resolved.fresh) {
      return preferencePage(token, resolved, "This link is too old to remove your address. You can still stop email below.");
    }
    await purgeFromUnsubscribe(db, resolved);
    await capture(context, resolved.clubSlug, { scope: "purge", source: "link", purpose: resolved.purpose });
    return preferencePage(token, { ...resolved, contact: null }, "Your email address has been removed.");
  }

  await withdrawContact(db, {
    clubSlug: resolved.clubSlug,
    contactId: resolved.contactId,
    scope: action,
    source: oneClick ? "one_click" : "link",
    purpose: resolved.purpose,
    batchId: resolved.batchId,
    ipAddress: requestIp(context.request),
  });
  await markUnsubscribeTokenUsed(db, resolved.tokenHash);
  await capture(context, resolved.clubSlug, {
    scope: action,
    source: oneClick ? "one_click" : "link",
    purpose: resolved.purpose,
  });

  if (oneClick) {
    return new Response("Unsubscribed", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  const after = await resolveUnsubscribeToken(db, token);
  return preferencePage(
    token,
    after ?? resolved,
    action === "marketing"
      ? "Done — no more club news and offers. You'll still get admin and safety messages."
      : "Done — you won't get any more email from this club.",
  );
};
