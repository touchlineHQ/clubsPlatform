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

/** FA statuses that are not a live membership at the club. */
export const LAPSED_REGISTRATION_STATUSES: readonly string[] = [
  "cancelled",
  "transferred",
];

/** True when registrationStatus represents a live registration (#133). */
export function isLiveRegistrationStatus(
  registrationStatus: string | null | undefined,
): boolean {
  const status = (registrationStatus ?? "").trim().toLowerCase();
  if (!status) return false;
  return !LAPSED_REGISTRATION_STATUSES.includes(status);
}

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
 * Live registrationStatus for a player at a club, optionally scoped to a team.
 * Returns the first live status found, or the first lapsed/empty row's status
 * when nothing is live (so drops can record what was seen).
 */
export async function liveRegistrationStatusForPlayer(
  db: D1Database,
  clubSlug: string,
  playerId: string,
  teamName?: string,
): Promise<string | null> {
  let sql =
    `SELECT registrationStatus FROM "player_registration"
      WHERE clubSlug = ? AND playerId = ?`;
  const binds: unknown[] = [clubSlug, playerId];
  if (teamName) {
    sql += ` AND teamName = ? COLLATE NOCASE`;
    binds.push(teamName.trim());
  }
  sql += ` ORDER BY updatedAt DESC`;

  const res = await db.prepare(sql).bind(...binds).all<{ registrationStatus: string | null }>();
  const rows = res.results ?? [];
  if (rows.length === 0) return null;

  for (const row of rows) {
    if (isLiveRegistrationStatus(row.registrationStatus)) {
      return row.registrationStatus;
    }
  }
  return rows[0].registrationStatus ?? null;
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
    const registrationStatus = await liveRegistrationStatusForPlayer(
      db,
      clubSlug,
      contact.playerId,
      opts?.teamName,
    );
    base.registrationStatus = registrationStatus;

    if (contact.operationalOptIn !== 1) {
      return { ...base, eligible: false, dropReason: "no_operational_opt_in" };
    }
    if (!isLiveRegistrationStatus(registrationStatus)) {
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

  for (const candidate of candidates) {
    const result = await evaluateContactForPurpose(
      db,
      clubSlug,
      candidate,
      purpose,
      { teamName },
    );
    if (result.eligible) eligible.push(result);
    else dropped.push(result);
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

    try {
      const result = await mailer.send(message);
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
        providerMessageId: result.id ?? null,
      });
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
    }
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
  const capped = Math.min(Math.max(limit, 1), 200);
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
