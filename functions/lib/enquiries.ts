import type { D1Database } from "@cloudflare/workers-types";
import { escapeHtml, type BuiltMessage } from "./account-email";

/**
 * Player enquiries (#73): the step before FA registration.
 *
 * An enquiry is a lead, not a player record, and it expires. Contact fields
 * are nulled when it reaches a terminal status, by the stale purge after six
 * months untouched, and on one-click delete the whole row goes.
 */

export const ENQUIRY_STATUSES = ["new", "contacted", "fa_sent", "registered", "declined"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const TERMINAL_STATUSES: readonly EnquiryStatus[] = ["registered", "declined"];

/** Six months, in ms. Anything not updated for this long loses its contact fields. */
export const STALE_AFTER_MS = 183 * 24 * 60 * 60 * 1000;

/** Default when a club has not set its own FA "club invite" link. */
export const DEFAULT_FA_REGISTRATION_URL = "https://myaccount.thefa.com";

export const RATE_LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export function isEnquiryStatus(v: unknown): v is EnquiryStatus {
  return typeof v === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(v);
}

/**
 * The age group a team name belongs to: "U12 Reds" → "U12", "Under 9s" → "U9".
 * Teams without an under-N marker are adult football and fall in "Open Age".
 */
export function ageGroupOf(teamName: string): string {
  const m = /\b(?:u|under)[\s-]?(\d{1,2})s?\b/i.exec(teamName);
  return m ? `U${Number(m[1])}` : "Open Age";
}

/**
 * Under 16 → guardian contact only (the FA requires a parent or guardian to
 * manage England Football accounts below 16). U16 sides are included: their
 * players are 15 when the season starts. One platform-wide rule.
 */
export function isUnder16AgeGroup(ageGroup: string): boolean {
  const m = /^U(\d{1,2})$/.exec(ageGroup);
  return !!m && Number(m[1]) <= 16;
}

export interface EnquiryFormOptions {
  ageGroups: { ageGroup: string; under16: boolean; teams: string[] }[];
}

/** Age groups (and their teams) from the club's own configured teams, youngest first. */
export async function loadFormOptions(db: D1Database, clubSlug: string): Promise<EnquiryFormOptions> {
  const { results } = await db
    .prepare(
      `SELECT t.name AS name FROM team t JOIN team_section s ON s.id = t.sectionId
       WHERE s.clubSlug = ? ORDER BY s.sortOrder, t.sortOrder LIMIT 500`,
    )
    .bind(clubSlug)
    .all<{ name: string }>();
  const groups = new Map<string, string[]>();
  for (const { name } of results ?? []) {
    const g = ageGroupOf(name);
    const list = groups.get(g) ?? [];
    if (!list.includes(name)) list.push(name);
    groups.set(g, list);
  }
  const order = (g: string) => (g.startsWith("U") ? Number(g.slice(1)) : 99);
  return {
    ageGroups: [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([ageGroup, teams]) => ({ ageGroup, under16: isUnder16AgeGroup(ageGroup), teams })),
  };
}

export interface EnquiryInput {
  ageGroup: string;
  team: string | null;
  enquirerType: "guardian" | "player";
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  playerFirstName: string | null;
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const PHONE_RE = /^[0-9+()\s-]{6,20}$/;

function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

/**
 * Validate a submission against the club's own options. Only the listed
 * fields are read; anything else in the body is ignored, never stored.
 */
export function validateEnquiry(
  raw: unknown,
  options: EnquiryFormOptions,
): { error: string } | { value: EnquiryInput } {
  if (!raw || typeof raw !== "object") return { error: "Body must be an object" };
  const r = raw as Record<string, unknown>;
  if (r.consent !== true) return { error: "Consent is required" };

  const ageGroup = text(r.ageGroup, 20);
  const group = options.ageGroups.find((g) => g.ageGroup === ageGroup);
  if (!ageGroup || !group) return { error: "Choose an age group" };

  const team = text(r.team, 100);
  if (team === undefined || (team !== null && !group.teams.includes(team))) {
    return { error: "Team is not in that age group" };
  }

  if (r.enquirerType !== "guardian" && r.enquirerType !== "player") {
    return { error: "enquirerType must be guardian or player" };
  }
  if (group.under16 && r.enquirerType !== "guardian") {
    return { error: "Under 16s must be enquired for by a parent or guardian" };
  }

  const contactName = text(r.contactName, 100);
  if (!contactName) return { error: "Your name is required" };
  const contactEmail = text(r.contactEmail, 254);
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) return { error: "A valid email is required" };
  const contactPhone = text(r.contactPhone, 20);
  if (contactPhone === undefined || (contactPhone !== null && !PHONE_RE.test(contactPhone))) {
    return { error: "Phone number is not valid" };
  }
  // First name only: keep the first word, never a surname.
  const first = text(r.playerFirstName, 50);
  if (first === undefined) return { error: "Player first name is too long" };
  const playerFirstName = first === null ? null : first.split(" ")[0];

  return {
    value: {
      ageGroup,
      team,
      enquirerType: r.enquirerType,
      contactName,
      contactEmail: contactEmail.toLowerCase(),
      contactPhone,
      playerFirstName,
    },
  };
}

/** Null the contact fields, keeping age group, dates and outcome. */
const NULL_CONTACT = `"contactName" = NULL, "contactEmail" = NULL, "contactPhone" = NULL, "playerFirstName" = NULL`;

/**
 * Null the contact fields of every enquiry untouched for six months.
 *
 * Pages Functions cannot run Cron Triggers, so this runs opportunistically on
 * each public submission and each admin list load: one indexed UPDATE with a
 * single bound value, across all clubs. Returns how many rows it purged.
 */
export async function purgeStaleEnquiries(db: D1Database, now: number): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE "player_enquiry" SET ${NULL_CONTACT}, "contactPurgedAt" = ?
       WHERE "contactPurgedAt" IS NULL AND "updatedAt" < ?`,
    )
    .bind(now, now - STALE_AFTER_MS)
    .run();
  return res.meta?.changes ?? 0;
}

export type SetEnquiryStatusResult = "updated" | "not_found" | "conflict";

/**
 * Move an enquiry to a new status. Reaching registered / declined nulls the
 * contact fields in the same statement, so there is no window where a closed
 * lead still holds an address.
 *
 * Terminal statuses are sticky: a row already at registered/declined cannot
 * move again (contact details are gone). Returns "conflict" in that case,
 * "not_found" when the row is missing, otherwise "updated".
 */
export async function setEnquiryStatus(
  db: D1Database,
  clubSlug: string,
  id: string,
  status: EnquiryStatus,
  now: number,
): Promise<SetEnquiryStatusResult> {
  const terminal = TERMINAL_STATUSES.includes(status);
  const res = await db
    .prepare(
      `UPDATE "player_enquiry" SET "status" = ?, "updatedAt" = ?${
        terminal ? `, ${NULL_CONTACT}, "contactPurgedAt" = COALESCE("contactPurgedAt", ?)` : ""
      } WHERE "id" = ? AND "clubSlug" = ? AND "status" NOT IN ('registered', 'declined')`,
    )
    .bind(...(terminal ? [status, now, now, id, clubSlug] : [status, now, id, clubSlug]))
    .run();
  if ((res.meta?.changes ?? 0) > 0) return "updated";
  const existing = await db
    .prepare(`SELECT "status" FROM "player_enquiry" WHERE "id" = ? AND "clubSlug" = ?`)
    .bind(id, clubSlug)
    .first<{ status: string }>();
  return existing ? "conflict" : "not_found";
}

/** One-click erasure: removes the whole row. */
export async function deleteEnquiry(db: D1Database, clubSlug: string, id: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM "player_enquiry" WHERE "id" = ? AND "clubSlug" = ?`)
    .bind(id, clubSlug)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Count one submission against the caller's IP for the current hour and say
 * whether it is allowed. The IP is stored only as a salted hash.
 */
export async function checkRateLimit(
  db: D1Database,
  ip: string,
  salt: string,
  now: number,
): Promise<boolean> {
  const windowStart = now - (now % HOUR_MS);
  const key = `${await sha256Hex(`${salt}:${ip}`)}:${windowStart}`;
  const [, upsert] = await db.batch([
    db.prepare(`DELETE FROM "enquiry_rate_limit" WHERE "windowStart" < ?`).bind(windowStart - HOUR_MS),
    db
      .prepare(
        `INSERT INTO "enquiry_rate_limit" ("key", "count", "windowStart") VALUES (?, 1, ?)
         ON CONFLICT("key") DO UPDATE SET "count" = "count" + 1 RETURNING "count"`,
      )
      .bind(key, windowStart),
  ]);
  const count = (upsert?.results?.[0] as { count?: number } | undefined)?.count ?? 1;
  return count <= RATE_LIMIT_PER_HOUR;
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Ask Cloudflare whether the Turnstile token is genuine. Any failure is a rejection. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}

function layout(clubName: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;">${escapeHtml(clubName)}</h1>
      ${body}
    </div>
  </body>
</html>`;
}

const P = `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">`;

/** Acknowledgement to the enquirer, carrying the FA registration link. */
export function enquiryAckMessage(clubName: string, ageGroup: string, faUrl: string): BuiltMessage {
  return {
    subject: `Thanks for your interest in ${clubName}`,
    html: layout(
      clubName,
      `${P}Thanks for getting in touch about ${escapeHtml(ageGroup)} football. Our club secretary will be in touch soon.</p>
      ${P}Players are registered with the FA through an England Football account. If you do not have one yet, you can set it up now:</p>
      ${P}<a href="${escapeHtml(faUrl)}" style="color:#1a1a1a;">${escapeHtml(faUrl)}</a></p>
      ${P}We keep your details only while we deal with your enquiry, and delete them once it is closed or after six months.</p>`,
    ),
    text: `Thanks for getting in touch about ${ageGroup} football with ${clubName}. Our club secretary will be in touch soon.

Players are registered with the FA through an England Football account. If you do not have one yet, you can set it up now:
${faUrl}

We keep your details only while we deal with your enquiry, and delete them once it is closed or after six months.`,
  };
}

/** Notification to the club secretary. */
export function enquirySecretaryMessage(clubName: string, e: EnquiryInput, adminUrl: string): BuiltMessage {
  const rows: [string, string][] = [
    ["Age group", e.ageGroup],
    ["Team", e.team ?? "Not specified"],
    ["Enquiring as", e.enquirerType === "guardian" ? "Parent or guardian" : "Player"],
    ["Name", e.contactName],
    ["Email", e.contactEmail],
    ["Phone", e.contactPhone ?? "Not given"],
    ["Player first name", e.playerFirstName ?? "Not given"],
  ];
  return {
    subject: `New ${e.ageGroup} player enquiry`,
    html: layout(
      clubName,
      `${P}A new player enquiry has come in through the club website.</p>
      <table style="margin:0 0 16px;font-size:14px;border-collapse:collapse;">${rows
        .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
        .join("")}</table>
      ${P}Update its status as you go: <a href="${escapeHtml(adminUrl)}" style="color:#1a1a1a;">${escapeHtml(adminUrl)}</a></p>`,
    ),
    text: `A new player enquiry has come in through the club website.

${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}

Update its status as you go: ${adminUrl}`,
  };
}
