import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  nowMs,
  randomId,
  requirePermission,
  getClubSlug,
  isMultiClubMode,
} from "../../lib/api-helpers";
import { hasPermission } from "../../lib/permissions";
import { getClubIdentity } from "../../lib/club-identity";
import { sendClubEmail, type SendAudience } from "../../lib/send-guard";
import { clubSiteBase, textToHtml, whatsappCopyText } from "../../lib/announcement";

/**
 * Announcement composer (#74). One write lands in three places:
 *
 * 1. a news_item on the club site — the permanent record;
 * 2. optionally, operational email through the send guard, so only contacts
 *    with a lawful basis receive it (the guard derives recipients; none are
 *    accepted here);
 * 3. a plain-text copy block returned for pasting into WhatsApp.
 *
 * Publishing needs `content`; emailing additionally needs `members`, the same
 * permission /api/admin/email-send asks for. The permission check happens
 * before anything is written, so a refused email never leaves a half-made post.
 */

type Body = {
  title?: unknown;
  text?: unknown;
  body?: unknown;
  sections?: unknown;
  email?: unknown;
};

function parseEmailAudience(value: unknown): SendAudience | null | "invalid" {
  if (value === undefined || value === null || value === false) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "invalid";
  const v = value as Record<string, unknown>;
  if (v.type === "club") return { type: "club" };
  if (v.type === "team" && typeof v.teamName === "string" && v.teamName.trim()) {
    return { type: "team", teamName: v.teamName.trim() };
  }
  return "invalid";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "content");
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: Body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }

  // Same rule as the admin send: recipients are never caller-supplied.
  for (const key of ["to", "emails", "recipients", "addresses"]) {
    if (key in body) {
      return json(
        { error: "Recipients cannot be supplied", code: "forbidden_call_site_field", field: key },
        { status: 403 },
      );
    }
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const longBody = typeof body.body === "string" && body.body.trim() ? body.body.trim() : null;
  if (!title || !text) return json({ error: "title and text are required" }, { status: 400 });

  let sections: string[] | null = null;
  if (body.sections !== undefined && body.sections !== null) {
    if (!Array.isArray(body.sections) || !body.sections.every((s) => typeof s === "string")) {
      return json({ error: "sections must be an array of strings" }, { status: 400 });
    }
    sections = body.sections.length ? (body.sections as string[]) : null;
  }

  const audience = parseEmailAudience(body.email);
  if (audience === "invalid") {
    return json(
      { error: "email must be { type: 'club' } or { type: 'team', teamName }" },
      { status: 400 },
    );
  }
  if (audience && !hasPermission(auth.role, "members")) {
    return json(
      { error: "Emailing members needs the members permission", code: "email_not_permitted" },
      { status: 403 },
    );
  }

  const origin = new URL(context.request.url).origin;
  const newsUrl = `${clubSiteBase(origin, clubSlug, isMultiClubMode(context.env))}#/news`;
  const id = randomId("news");
  const ts = nowMs();
  await context.env.DB
    .prepare(
      `INSERT INTO news_item (id, clubSlug, title, text, body, link, linkText, sections, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, clubSlug, title, text, longBody, "#", "Read More", sections ? JSON.stringify(sections) : null, ts, ts)
    .run();

  const identity = await getClubIdentity(context.env.DB, clubSlug);
  const clubName = identity?.name ?? "Your club";
  const copyText = whatsappCopyText({ clubName, title, text, body: longBody, link: newsUrl });

  let email: null | {
    batchId: string;
    mailConfigured: boolean;
    sentCount: number;
    droppedCount: number;
  } = null;
  if (audience) {
    const plain = [text, longBody, `Read it on the club site: ${newsUrl}`].filter(Boolean).join("\n\n");
    const result = await sendClubEmail(context.env, context.env.DB, {
      clubSlug,
      purpose: "operational",
      audience,
      subject: `${clubName}: ${title}`,
      html: textToHtml(plain),
      text: plain,
      initiatedBy: (auth.session.user as Record<string, unknown>).id as string,
      clubName,
      origin,
    });
    email = {
      batchId: result.batchId,
      mailConfigured: result.mailConfigured,
      sentCount: result.sent.filter((s) => s.outcome === "sent").length,
      droppedCount: result.dropped.length,
    };
  }

  return json(
    {
      ok: true,
      item: { id, title, text, body: longBody ?? undefined, link: "#", linkText: "Read More", sections: sections ?? undefined },
      copyText,
      email,
    },
    { status: 201 },
  );
};
