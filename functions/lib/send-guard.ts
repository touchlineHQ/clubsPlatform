import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import { latestConsentRecord } from "./consent";
import { getMailer, type MailEnv, type Mailer, type OutboundMessage } from "./email";

/**
 * Structural email send guard (#133).
 *
 * Purpose decides eligibility. Recipients are derived from purpose + audience;
 * callers never supply an address list. The provider is reached only through
 * sendClubEmail — there is no path that bypasses purpose checks for
 * player_contact rows.
 */

export type EmailPurpose = "transactional" | "operational" | "marketing";

/**
 * Who to consider. Never an email address — the guard looks up contact rows.
 * `team` / `club` / `player` expand to contact candidates; `contact` is one id.
 */
export type SendAudience =
  | { type: "team"; teamName: string }
  | { type: "club" }
  | { type: "player"; playerId: string }
  | { type: "contact"; contactId: string };

export type DropReason =
  | "pending"
  | "withdrawn"
  | "bounced"
  | "not_confirmed"
  | "missing_marketing_consent"
  | "lapsed_registration"
  | "no_operational_opt_in"
  | "not_found"
  | "duplicate_email"
  | "provider_rejected";

export type SendOutcome = "sent" | "dropped" | "skipped_unconfigured";

export type ContactSendState = {
  contactId: string;
  email: string;
  playerId: string;
  contactState: string;
  operationalOptIn: number;
  marketingOptIn: number;
  registrationStatus: string | null;
  marketingConsentState: string | null;
};

export type EligibleRecipient = ContactSendState & {
  eligible: true;
};

export type DroppedRecipient = ContactSendState & {
  eligible: false;
  dropReason: DropReason;
};

export type AudienceResolution = {
  eligible: EligibleRecipient[];
  dropped: DroppedRecipient[];
};

/**
 * Confirmed live FA registration statuses for operational mail (#133).
 *
 * Fail closed: the importer stores arbitrary status strings, so unknown values
 * must not pass the send guard. FA Club Player Report uses "Active" for a
 * current membership; cancelled / transferred / pending / anything else is not
 * operationally reachable.
 */
export const LIVE_REGISTRATION_STATUSES: readonly string[] = [
  "active",
];

/** @deprecated Kept for callers/tests that named the denylist; prefer the allowlist. */
export const LAPSED_REGISTRATION_STATUSES: readonly string[] = [
  "cancelled",
  "transferred",
];

/** True when registrationStatus is on the live allowlist (case-insensitive). */
export function isLiveRegistrationStatus(
  registrationStatus: string | null | undefined,
): boolean {
  const status = (registrationStatus ?? "").trim().toLowerCase();
  if (!status) return false;
  return (LIVE_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Parse FA / import registrationExpiry text to a UTC end-of-day instant.
 * Supports ISO `YYYY-MM-DD` and UK `DD/MM/YYYY` (also `-` separators).
 * Returns null for blank **or** malformed input — callers must distinguish
 * blank vs invalid via `isRegistrationExpiryCurrent` (blank OK, invalid not).
 *
 * Rejects impossible calendar dates (`2026-02-30`): Date.UTC normalises those,
 * so we re-check Y/M/D on the constructed instant.
 */
export function parseRegistrationExpiry(
  registrationExpiry: string | null | undefined,
): Date | null {
  const raw = (registrationExpiry ?? "").trim();
  if (!raw) return null;

  let y: number;
  let m: number;
  let d: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    if (!uk) return null;
    d = Number(uk[1]);
    m = Number(uk[2]);
    y = Number(uk[3]);
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  if (Number.isNaN(dt.getTime())) return null;
  // Date.UTC rolls over invalid days (Feb 30 → Mar 2); reject those.
  if (
    dt.getUTCFullYear() !== y
    || dt.getUTCMonth() !== m - 1
    || dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Blank / missing expiry → current (no constraint).
 * Malformed non-blank expiry → not current (fail closed).
 * Parsed past end-of-day → not current.
 */
export function isRegistrationExpiryCurrent(
  registrationExpiry: string | null | undefined,
  nowMsValue: number = Date.now(),
): boolean {
  const raw = (registrationExpiry ?? "").trim();
  if (!raw) return true;
  const end = parseRegistrationExpiry(raw);
  if (!end) return false;
  return end.getTime() >= nowMsValue;
}

/** Status allowlist + unexpired (or blank/unparseable) expiry. */
export function isLiveRegistration(
  registrationStatus: string | null | undefined,
  registrationExpiry: string | null | undefined,
  nowMsValue: number = Date.now(),
): boolean {
  return (
    isLiveRegistrationStatus(registrationStatus)
    && isRegistrationExpiryCurrent(registrationExpiry, nowMsValue)
  );
}

export type RegistrationLiveProbe = {
  registrationStatus: string | null;
  registrationExpiry: string | null;
  live: boolean;
};

type ContactCandidateRow = {
  id: string;
  email: string;
  playerId: string;
  state: string;
  operationalOptIn: number;
  marketingOptIn: number;
};

function audienceKey(audience: SendAudience): string | null {
  if (audience.type === "team") return audience.teamName;
  if (audience.type === "player") return audience.playerId;
  if (audience.type === "contact") return audience.contactId;
  return null;
}

/**
 * Load candidate player_contact rows for an audience. Does not apply purpose
 * filters — evaluateContactForPurpose does that per row against live state.
 */
export async function loadAudienceCandidates(
  db: D1Database,
  clubSlug: string,
  audience: SendAudience,
): Promise<ContactCandidateRow[]> {
  if (audience.type === "contact") {
    const row = await db
      .prepare(
        `SELECT id, email, playerId, state, operationalOptIn, marketingOptIn
           FROM "player_contact"
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(audience.contactId, clubSlug)
      .first<ContactCandidateRow>();
    return row ? [row] : [];
  }

  if (audience.type === "player") {
    const res = await db
      .prepare(
        `SELECT id, email, playerId, state, operationalOptIn, marketingOptIn
           FROM "player_contact"
          WHERE clubSlug = ? AND playerId = ?`,
      )
      .bind(clubSlug, audience.playerId)
      .all<ContactCandidateRow>();
    return res.results ?? [];
  }

  if (audience.type === "team") {
    const res = await db
      .prepare(
        `SELECT DISTINCT pc.id, pc.email, pc.playerId, pc.state,
                pc.operationalOptIn, pc.marketingOptIn
           FROM "player_contact" pc
           JOIN "player_registration" pr
             ON pr.playerId = pc.playerId AND pr.clubSlug = pc.clubSlug
          WHERE pc.clubSlug = ?
            AND pr.teamName = ? COLLATE NOCASE`,
      )
      .bind(clubSlug, audience.teamName.trim())
      .all<ContactCandidateRow>();
    return res.results ?? [];
  }

  // club
  const res = await db
    .prepare(
      `SELECT id, email, playerId, state, operationalOptIn, marketingOptIn
         FROM "player_contact"
        WHERE clubSlug = ?`,
    )
    .bind(clubSlug)
    .all<ContactCandidateRow>();
  return res.results ?? [];
}

/**
 * Probe live registration for a player at a club (optionally scoped to a team).
 * Prefers a row that passes status allowlist + expiry; otherwise returns the
 * most recently updated row so drops can record the status/expiry relied on.
 */
export async function probeLiveRegistrationForPlayer(
  db: D1Database,
  clubSlug: string,
  playerId: string,
  teamName?: string,
  nowMsValue: number = Date.now(),
): Promise<RegistrationLiveProbe> {
  let sql =
    `SELECT registrationStatus, registrationExpiry FROM "player_registration"
      WHERE clubSlug = ? AND playerId = ?`;
  const binds: unknown[] = [clubSlug, playerId];
  if (teamName) {
    sql += ` AND teamName = ? COLLATE NOCASE`;
    binds.push(teamName.trim());
  }
  sql += ` ORDER BY updatedAt DESC`;

  const res = await db.prepare(sql).bind(...binds).all<{
    registrationStatus: string | null;
    registrationExpiry: string | null;
  }>();
  const rows = res.results ?? [];
  if (rows.length === 0) {
    return { registrationStatus: null, registrationExpiry: null, live: false };
  }

  for (const row of rows) {
    if (isLiveRegistration(row.registrationStatus, row.registrationExpiry, nowMsValue)) {
      return {
        registrationStatus: row.registrationStatus,
        registrationExpiry: row.registrationExpiry,
        live: true,
      };
    }
  }

  const first = rows[0];
  return {
    registrationStatus: first.registrationStatus ?? null,
    registrationExpiry: first.registrationExpiry ?? null,
    live: false,
  };
}

/** @deprecated Prefer probeLiveRegistrationForPlayer — status alone ignores expiry. */
export async function liveRegistrationStatusForPlayer(
  db: D1Database,
  clubSlug: string,
  playerId: string,
  teamName?: string,
): Promise<string | null> {
  const probe = await probeLiveRegistrationForPlayer(db, clubSlug, playerId, teamName);
  return probe.live ? probe.registrationStatus : (probe.registrationStatus);
}

function dropReasonForState(state: string): DropReason {
  if (state === "pending") return "pending";
  if (state === "withdrawn") return "withdrawn";
  if (state === "bounced") return "bounced";
  return "not_confirmed";
}

/**
 * Decide whether one contact may receive mail of `purpose`, recording the
 * consent / registration state relied on.
 */
export async function evaluateContactForPurpose(
  db: D1Database,
  clubSlug: string,
  contact: ContactCandidateRow | null,
  purpose: EmailPurpose,
  opts?: { teamName?: string },
): Promise<EligibleRecipient | DroppedRecipient> {
  if (!contact) {
    return {
      contactId: "",
      email: "",
      playerId: "",
      contactState: "",
      operationalOptIn: 0,
      marketingOptIn: 0,
      registrationStatus: null,
      marketingConsentState: null,
      eligible: false,
      dropReason: "not_found",
    };
  }

  const base: ContactSendState = {
    contactId: contact.id,
    email: contact.email,
    playerId: contact.playerId,
    contactState: contact.state,
    operationalOptIn: contact.operationalOptIn,
    marketingOptIn: contact.marketingOptIn,
    registrationStatus: null,
    marketingConsentState: null,
  };

  if (contact.state !== "confirmed") {
    return {
      ...base,
      eligible: false,
      dropReason: dropReasonForState(contact.state),
    };
  }

  if (purpose === "transactional") {
    return { ...base, eligible: true };
  }

  if (purpose === "operational") {
    const probe = await probeLiveRegistrationForPlayer(
      db,
      clubSlug,
      contact.playerId,
      opts?.teamName,
    );
    base.registrationStatus = probe.registrationStatus;

    if (contact.operationalOptIn !== 1) {
      return { ...base, eligible: false, dropReason: "no_operational_opt_in" };
    }
    if (!probe.live) {
      return { ...base, eligible: false, dropReason: "lapsed_registration" };
    }
    return { ...base, eligible: true };
  }

  // marketing — consent_record is authoritative (#75); marketingOptIn is a mirror.
  const latest = await latestConsentRecord(db, {
    clubSlug,
    subjectType: "player_contact",
    subjectId: contact.id,
  });
  base.marketingConsentState = latest?.state ?? null;

  if (latest?.state !== "granted") {
    return { ...base, eligible: false, dropReason: "missing_marketing_consent" };
  }
  return { ...base, eligible: true };
}

/**
 * Derive eligible + dropped recipients from purpose + audience.
 * Callers must not supply email addresses.
 */
export async function resolveAudienceRecipients(
  db: D1Database,
  clubSlug: string,
  purpose: EmailPurpose,
  audience: SendAudience,
): Promise<AudienceResolution> {
  const candidates = await loadAudienceCandidates(db, clubSlug, audience);
  const teamName = audience.type === "team" ? audience.teamName : undefined;

  if (audience.type === "contact" && candidates.length === 0) {
    const missing = await evaluateContactForPurpose(db, clubSlug, null, purpose);
    return { eligible: [], dropped: [missing as DroppedRecipient] };
  }

  const eligible: EligibleRecipient[] = [];
  const dropped: DroppedRecipient[] = [];
  // One physical inbox gets one message per send, even when a parent has
  // contacts for two siblings (#133 / CodeRabbit). Every contact still gets an
  // audit row — duplicates are dropped with reason duplicate_email.
  const seenEmails = new Set<string>();

  for (const candidate of candidates) {
    const result = await evaluateContactForPurpose(
      db,
      clubSlug,
      candidate,
      purpose,
      { teamName },
    );
    if (!result.eligible) {
      dropped.push(result);
      continue;
    }
    const key = result.email.trim().toLowerCase();
    if (seenEmails.has(key)) {
      dropped.push({
        ...result,
        eligible: false,
        dropReason: "duplicate_email",
      });
      continue;
    }
    seenEmails.add(key);
    eligible.push(result);
  }

  return { eligible, dropped };
}

export type SendClubEmailInput = {
  clubSlug: string;
  purpose: EmailPurpose;
  audience: SendAudience;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
  initiatedBy?: string | null;
  /** Injected mailer for tests; production uses getMailer(env). */
  mailer?: Mailer | null;
};

export type SendClubEmailResult = {
  batchId: string;
  mailConfigured: boolean;
  sent: Array<{ contactId: string; outcome: SendOutcome }>;
  dropped: Array<{ contactId: string; dropReason: DropReason }>;
  resolution: AudienceResolution;
};

async function recordSendEvent(
  db: D1Database,
  row: {
    clubSlug: string;
    batchId: string;
    purpose: EmailPurpose;
    contactId: string;
    outcome: SendOutcome;
    dropReason: DropReason | null;
    contactState: string | null;
    operationalOptIn: number | null;
    marketingOptIn: number | null;
    marketingConsentState: string | null;
    registrationStatus: string | null;
    audienceType: string;
    audienceKey: string | null;
    initiatedBy: string | null;
    providerMessageId: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO "email_send_event"
         (id, clubSlug, batchId, purpose, contactId, outcome, dropReason,
          contactState, operationalOptIn, marketingOptIn, marketingConsentState,
          registrationStatus, audienceType, audienceKey, initiatedBy,
          providerMessageId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomId("emsend"),
      row.clubSlug,
      row.batchId,
      row.purpose,
      row.contactId || "unknown",
      row.outcome,
      row.dropReason,
      row.contactState,
      row.operationalOptIn,
      row.marketingOptIn,
      row.marketingConsentState,
      row.registrationStatus,
      row.audienceType,
      row.audienceKey,
      row.initiatedBy,
      row.providerMessageId,
      nowMs(),
    )
    .run();
}

/**
 * The only supported path for purpose-gated club contact email.
 * Derives recipients, records every send/drop with the state relied on, and
 * only then calls the provider (when configured).
 */
export async function sendClubEmail(
  env: MailEnv,
  db: D1Database,
  input: SendClubEmailInput,
): Promise<SendClubEmailResult> {
  const batchId = randomId("embatch");
  const resolution = await resolveAudienceRecipients(
    db,
    input.clubSlug,
    input.purpose,
    input.audience,
  );
  const audKey = audienceKey(input.audience);
  const mailer = input.mailer !== undefined ? input.mailer : getMailer(env);
  const mailConfigured = mailer !== null;

  const sent: SendClubEmailResult["sent"] = [];
  const dropped: SendClubEmailResult["dropped"] = [];

  for (const drop of resolution.dropped) {
    dropped.push({ contactId: drop.contactId, dropReason: drop.dropReason });
    await recordSendEvent(db, {
      clubSlug: input.clubSlug,
      batchId,
      purpose: input.purpose,
      contactId: drop.contactId,
      outcome: "dropped",
      dropReason: drop.dropReason,
      contactState: drop.contactState || null,
      operationalOptIn: drop.contactId ? drop.operationalOptIn : null,
      marketingOptIn: drop.contactId ? drop.marketingOptIn : null,
      marketingConsentState: drop.marketingConsentState,
      registrationStatus: drop.registrationStatus,
      audienceType: input.audience.type,
      audienceKey: audKey,
      initiatedBy: input.initiatedBy ?? null,
      providerMessageId: null,
    });
  }

  for (const recipient of resolution.eligible) {
    if (!mailer) {
      sent.push({ contactId: recipient.contactId, outcome: "skipped_unconfigured" });
      await recordSendEvent(db, {
        clubSlug: input.clubSlug,
        batchId,
        purpose: input.purpose,
        contactId: recipient.contactId,
        outcome: "skipped_unconfigured",
        dropReason: null,
        contactState: recipient.contactState,
        operationalOptIn: recipient.operationalOptIn,
        marketingOptIn: recipient.marketingOptIn,
        marketingConsentState: recipient.marketingConsentState,
        registrationStatus: recipient.registrationStatus,
        audienceType: input.audience.type,
        audienceKey: audKey,
        initiatedBy: input.initiatedBy ?? null,
        providerMessageId: null,
      });
      continue;
    }

    const message: OutboundMessage = {
      to: recipient.email,
      subject: input.subject,
      html: input.html,
      text: input.text,
      fromName: input.fromName,
      replyTo: input.replyTo,
    };

    let providerMessageId: string | null = null;
    try {
      const result = await mailer.send(message);
      providerMessageId = result.id ?? null;
    } catch {
      dropped.push({ contactId: recipient.contactId, dropReason: "provider_rejected" });
      await recordSendEvent(db, {
        clubSlug: input.clubSlug,
        batchId,
        purpose: input.purpose,
        contactId: recipient.contactId,
        outcome: "dropped",
        dropReason: "provider_rejected",
        contactState: recipient.contactState,
        operationalOptIn: recipient.operationalOptIn,
        marketingOptIn: recipient.marketingOptIn,
        marketingConsentState: recipient.marketingConsentState,
        registrationStatus: recipient.registrationStatus,
        audienceType: input.audience.type,
        audienceKey: audKey,
        initiatedBy: input.initiatedBy ?? null,
        providerMessageId: null,
      });
      continue;
    }

    // Audit after a successful provider call — a failed INSERT must not be
    // recorded as provider_rejected (the message already went out).
    sent.push({ contactId: recipient.contactId, outcome: "sent" });
    await recordSendEvent(db, {
      clubSlug: input.clubSlug,
      batchId,
      purpose: input.purpose,
      contactId: recipient.contactId,
      outcome: "sent",
      dropReason: null,
      contactState: recipient.contactState,
      operationalOptIn: recipient.operationalOptIn,
      marketingOptIn: recipient.marketingOptIn,
      marketingConsentState: recipient.marketingConsentState,
      registrationStatus: recipient.registrationStatus,
      audienceType: input.audience.type,
      audienceKey: audKey,
      initiatedBy: input.initiatedBy ?? null,
      providerMessageId,
    });
  }

  return {
    batchId,
    mailConfigured,
    sent,
    dropped,
    resolution,
  };
}

export type EmailSendEventRow = {
  id: string;
  clubSlug: string;
  batchId: string;
  purpose: EmailPurpose;
  contactId: string;
  outcome: SendOutcome;
  dropReason: DropReason | null;
  contactState: string | null;
  operationalOptIn: number | null;
  marketingOptIn: number | null;
  marketingConsentState: string | null;
  registrationStatus: string | null;
  audienceType: string;
  audienceKey: string | null;
  initiatedBy: string | null;
  providerMessageId: string | null;
  createdAt: number;
};

/** Recent send/drop events for admin surfacing (#133). */
export async function listEmailSendEvents(
  db: D1Database,
  clubSlug: string,
  {
    outcome,
    limit = 50,
  }: {
    outcome?: SendOutcome;
    limit?: number;
  } = {},
): Promise<EmailSendEventRow[]> {
  const capped = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 200);
  if (outcome) {
    const res = await db
      .prepare(
        `SELECT id, clubSlug, batchId, purpose, contactId, outcome, dropReason,
                contactState, operationalOptIn, marketingOptIn, marketingConsentState,
                registrationStatus, audienceType, audienceKey, initiatedBy,
                providerMessageId, createdAt
           FROM "email_send_event"
          WHERE clubSlug = ? AND outcome = ?
          ORDER BY createdAt DESC
          LIMIT ?`,
      )
      .bind(clubSlug, outcome, capped)
      .all<EmailSendEventRow>();
    return res.results ?? [];
  }

  const res = await db
    .prepare(
      `SELECT id, clubSlug, batchId, purpose, contactId, outcome, dropReason,
              contactState, operationalOptIn, marketingOptIn, marketingConsentState,
              registrationStatus, audienceType, audienceKey, initiatedBy,
              providerMessageId, createdAt
         FROM "email_send_event"
        WHERE clubSlug = ?
        ORDER BY createdAt DESC
        LIMIT ?`,
    )
    .bind(clubSlug, capped)
    .all<EmailSendEventRow>();
  return res.results ?? [];
}

export function parseEmailPurpose(raw: unknown): EmailPurpose | null {
  if (raw === "transactional" || raw === "operational" || raw === "marketing") return raw;
  return null;
}

export function parseSendAudience(raw: unknown): SendAudience | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (type === "club") return { type: "club" };
  if (type === "team" && typeof obj.teamName === "string" && obj.teamName.trim()) {
    return { type: "team", teamName: obj.teamName.trim() };
  }
  if (type === "player" && typeof obj.playerId === "string" && obj.playerId.trim()) {
    return { type: "player", playerId: obj.playerId.trim() };
  }
  if (type === "contact" && typeof obj.contactId === "string" && obj.contactId.trim()) {
    return { type: "contact", contactId: obj.contactId.trim() };
  }
  return null;
}
