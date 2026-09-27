import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import {
  type ConsentPolicySubmission,
  hashToken,
  randomTokenHex,
  recordMarketingConsentGrant,
  recordOperationalConsentGrant,
  withdrawOperationalConsent,
  latestConsentRecord,
} from "./consent";
import {
  currentSignoffAcceptanceId,
  hasCurrentEmailSignoff,
} from "./club-email-signoff";

/**
 * Parent-facing contact consent form (#149).
 *
 * A secretary ticking "we have consent" is not consent. This flow mints a
 * tokenised club URL the parent opens without an account, records operational
 * agreement (+ optional marketing) on player_contact / consent_record, and
 * never creates a user row.
 *
 * Activation tokens are hashed at rest (same pattern as marketing withdraw
 * tokens). Plaintext is returned once so the secretary can copy the link.
 */

/** Pending invitations expire after 30 days (docs/DATA_PROTECTION.md). */
export const ACTIVATION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ParentConsentContact = {
  id: string;
  clubSlug: string;
  playerId: string;
  email: string;
  relationship: "self" | "guardian";
  state: "pending" | "confirmed" | "withdrawn" | "bounced";
  operationalOptIn: number;
  marketingOptIn: number;
  activationExpiresAt: number | null;
  fanId: string | null;
};

export class ParentConsentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "expired"
      | "invalid_state"
      | "no_signoff"
      | "player_not_found"
      | "invalid_email"
      | "policy_mismatch",
  ) {
    super(message);
    this.name = "ParentConsentError";
  }
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Club-scoped path a secretary pastes into WhatsApp / email. */
export function consentFormPath(token: string): string {
  return `/#/consent/${encodeURIComponent(token)}`;
}

/**
 * Absolute URL under MULTI_CLUB slug paths, e.g.
 * `https://host/east-leake-fc/#/consent/<token>`.
 */
export function consentFormUrl(
  origin: string,
  clubSlug: string,
  token: string,
  multiClub: boolean,
): string {
  const base = multiClub
    ? `${origin.replace(/\/$/, "")}/${clubSlug}/`
    : `${origin.replace(/\/$/, "")}/`;
  return `${base}#/consent/${encodeURIComponent(token)}`;
}

async function loadByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<ParentConsentContact | null> {
  return db
    .prepare(
      `SELECT pc.id, pc.clubSlug, pc.playerId, pc.email, pc.relationship, pc.state,
              pc.operationalOptIn, pc.marketingOptIn, pc.activationExpiresAt,
              p.fanId
         FROM "player_contact" pc
         LEFT JOIN "player" p ON p.id = pc.playerId
        WHERE pc.activationTokenHash = ?`,
    )
    .bind(tokenHash)
    .first<ParentConsentContact>();
}

/** Resolve a plaintext activation token to its contact row. */
export async function findContactByActivationToken(
  db: D1Database,
  token: string,
): Promise<ParentConsentContact | null> {
  if (!token.trim()) return null;
  return loadByTokenHash(db, await hashToken(token.trim()));
}

/**
 * Create or refresh a pending player_contact and mint an activation token.
 * Marketing is never set here — only the parent form can opt in.
 */
export async function askParentForContactConsent(
  db: D1Database,
  {
    clubSlug,
    fanId,
    email: rawEmail,
    relationship = "guardian",
    sourcedBy,
  }: {
    clubSlug: string;
    fanId: string;
    email: string;
    relationship?: "self" | "guardian";
    sourcedBy: string;
  },
): Promise<{
  contactId: string;
  state: string;
  email: string;
  token: string;
  expiresAt: number;
  consentPath: string;
  created: boolean;
}> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new ParentConsentError("email is invalid", "invalid_email");

  if (!(await hasCurrentEmailSignoff(db, clubSlug))) {
    throw new ParentConsentError(
      "Club must accept the current email sign-off before collecting contact addresses",
      "no_signoff",
    );
  }
  const signoffId = await currentSignoffAcceptanceId(db, clubSlug);

  const player = await db
    .prepare(`SELECT id FROM "player" WHERE fanId = ?`)
    .bind(fanId.trim())
    .first<{ id: string }>();
  if (!player) {
    throw new ParentConsentError("Player not found for FAN ID", "player_not_found");
  }

  const existing = await db
    .prepare(
      `SELECT id, state, email FROM "player_contact"
        WHERE clubSlug = ? AND playerId = ? AND email = ?`,
    )
    .bind(clubSlug, player.id, email)
    .first<{ id: string; state: string; email: string }>();

  if (existing && (existing.state === "confirmed" || existing.state === "bounced")) {
    throw new ParentConsentError(
      `Contact is already ${existing.state}; ask the parent to withdraw first if they need a new invitation`,
      "invalid_state",
    );
  }

  const token = randomTokenHex();
  const tokenHash = await hashToken(token);
  const expiresAt = nowMs() + ACTIVATION_TOKEN_TTL_MS;
  const sourcedAt = nowMs();

  if (existing) {
    // Refresh token on pending / withdrawn so the secretary can re-send.
    await db
      .prepare(
        `UPDATE "player_contact"
            SET state = 'pending',
                relationship = ?,
                operationalOptIn = 0,
                marketingOptIn = 0,
                sourcedBy = ?,
                sourcedAt = ?,
                signoffId = ?,
                confirmedAt = NULL,
                withdrawnAt = NULL,
                activationTokenHash = ?,
                activationExpiresAt = ?
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(
        relationship,
        sourcedBy,
        sourcedAt,
        signoffId,
        tokenHash,
        expiresAt,
        existing.id,
        clubSlug,
      )
      .run();

    return {
      contactId: existing.id,
      state: "pending",
      email,
      token,
      expiresAt,
      consentPath: consentFormPath(token),
      created: false,
    };
  }

  const contactId = randomId("pcontact");
  await db
    .prepare(
      `INSERT INTO "player_contact"
         (id, clubSlug, playerId, email, relationship, state,
          operationalOptIn, marketingOptIn, sourcedBy, sourcedAt, signoffId,
          confirmedAt, withdrawnAt, activationTokenHash, activationExpiresAt)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(
      contactId,
      clubSlug,
      player.id,
      email,
      relationship,
      sourcedBy,
      sourcedAt,
      signoffId,
      tokenHash,
      expiresAt,
    )
    .run();

  return {
    contactId,
    state: "pending",
    email,
    token,
    expiresAt,
    consentPath: consentFormPath(token),
    created: true,
  };
}

/** List contact rows for a FAN at a club (admin status view). */
export async function listContactsForFan(
  db: D1Database,
  clubSlug: string,
  fanId: string,
): Promise<Array<{
  id: string;
  email: string;
  relationship: string;
  state: string;
  operationalOptIn: number;
  marketingOptIn: number;
  sourcedAt: number;
  confirmedAt: number | null;
  withdrawnAt: number | null;
  activationExpiresAt: number | null;
  hasActiveToken: boolean;
}>> {
  const player = await db
    .prepare(`SELECT id FROM "player" WHERE fanId = ?`)
    .bind(fanId.trim())
    .first<{ id: string }>();
  if (!player) return [];

  const { results } = await db
    .prepare(
      `SELECT id, email, relationship, state, operationalOptIn, marketingOptIn,
              sourcedAt, confirmedAt, withdrawnAt, activationExpiresAt,
              activationTokenHash
         FROM "player_contact"
        WHERE clubSlug = ? AND playerId = ?
        ORDER BY sourcedAt DESC`,
    )
    .bind(clubSlug, player.id)
    .all<{
      id: string;
      email: string;
      relationship: string;
      state: string;
      operationalOptIn: number;
      marketingOptIn: number;
      sourcedAt: number;
      confirmedAt: number | null;
      withdrawnAt: number | null;
      activationExpiresAt: number | null;
      activationTokenHash: string | null;
    }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    relationship: row.relationship,
    state: row.state,
    operationalOptIn: row.operationalOptIn,
    marketingOptIn: row.marketingOptIn,
    sourcedAt: row.sourcedAt,
    confirmedAt: row.confirmedAt,
    withdrawnAt: row.withdrawnAt,
    activationExpiresAt: row.activationExpiresAt,
    hasActiveToken: !!row.activationTokenHash,
  }));
}

function assertTokenUsable(contact: ParentConsentContact): void {
  if (
    contact.activationExpiresAt != null
    && contact.activationExpiresAt < nowMs()
    && contact.state === "pending"
  ) {
    throw new ParentConsentError("This consent link has expired", "expired");
  }
}

/**
 * Parent submits the club-scoped form. Confirms the contact, records
 * operational agreement, and optionally grants marketing consent.
 * Never creates a user / account.
 */
export async function submitParentConsentForm(
  db: D1Database,
  {
    token,
    email: rawEmail,
    operationalPolicy,
    marketingOptIn,
    marketingPolicy,
    ipAddress,
  }: {
    token: string;
    email: string;
    operationalPolicy: ConsentPolicySubmission;
    marketingOptIn: boolean;
    marketingPolicy: ConsentPolicySubmission | null;
    ipAddress: string | null;
  },
): Promise<{ contactId: string; clubSlug: string; state: "confirmed" }> {
  const contact = await findContactByActivationToken(db, token);
  if (!contact) {
    throw new ParentConsentError("Consent link not found", "not_found");
  }
  if (contact.state === "withdrawn" || contact.state === "bounced") {
    throw new ParentConsentError(
      `This contact is ${contact.state}`,
      "invalid_state",
    );
  }
  assertTokenUsable(contact);

  const email = normalizeEmail(rawEmail);
  if (!email) throw new ParentConsentError("email is invalid", "invalid_email");

  if (marketingOptIn && !marketingPolicy) {
    throw new ParentConsentError(
      "Marketing policy version and wording hash are required when opting in",
      "policy_mismatch",
    );
  }

  // Record operational evidence first, then confirm the row. Marketing grant
  // (optional) syncs marketingOptIn via recordMarketingConsentGrant.
  try {
    await recordOperationalConsentGrant(db, {
      clubSlug: contact.clubSlug,
      subjectId: contact.id,
      ipAddress,
      policy: operationalPolicy,
    });
  } catch (err) {
    if (err && typeof err === "object" && (err as Error).name === "ConsentPolicyMismatchError") {
      throw new ParentConsentError((err as Error).message, "policy_mismatch");
    }
    throw err;
  }

  const confirmedAt = nowMs();
  // Keep the activation token so the same link can later withdraw (#149 minimal).
  // Clear expiry so a confirmed parent is not locked out of withdraw by the
  // 30-day pending invitation window.
  await db
    .prepare(
      `UPDATE "player_contact"
          SET email = ?,
              state = 'confirmed',
              operationalOptIn = 1,
              confirmedAt = ?,
              withdrawnAt = NULL,
              activationExpiresAt = NULL
        WHERE id = ? AND clubSlug = ?`,
    )
    .bind(email, confirmedAt, contact.id, contact.clubSlug)
    .run();

  if (marketingOptIn && marketingPolicy) {
    try {
      await recordMarketingConsentGrant(db, {
        clubSlug: contact.clubSlug,
        subjectType: "player_contact",
        subjectId: contact.id,
        ipAddress,
        policy: marketingPolicy,
      });
    } catch (err) {
      if (err && typeof err === "object" && (err as Error).name === "ConsentPolicyMismatchError") {
        throw new ParentConsentError((err as Error).message, "policy_mismatch");
      }
      throw err;
    }
  } else {
    // Ensure marketing stays off when the parent did not tick it — including
    // re-submits after a prior grant (re-ask refreshes to pending first).
    await db
      .prepare(
        `UPDATE "player_contact" SET marketingOptIn = 0
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(contact.id, contact.clubSlug)
      .run();
  }

  return { contactId: contact.id, clubSlug: contact.clubSlug, state: "confirmed" };
}

/**
 * Minimal withdraw-via-token on the same parent form (#149 / #135 follow-up).
 * Clears both opt-ins and marks the contact withdrawn. Also withdraws any
 * current marketing grant for this subject.
 */
export async function withdrawParentConsentByToken(
  db: D1Database,
  token: string,
  ipAddress: string | null,
): Promise<{ contactId: string; clubSlug: string }> {
  const contact = await findContactByActivationToken(db, token);
  if (!contact) {
    throw new ParentConsentError("Consent link not found", "not_found");
  }
  if (contact.state === "pending") {
    // Parent never confirmed — treat as cancelling the invitation.
    await db
      .prepare(
        `UPDATE "player_contact"
            SET state = 'withdrawn',
                operationalOptIn = 0,
                marketingOptIn = 0,
                withdrawnAt = ?,
                activationTokenHash = NULL,
                activationExpiresAt = NULL
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(nowMs(), contact.id, contact.clubSlug)
      .run();
    return { contactId: contact.id, clubSlug: contact.clubSlug };
  }
  if (contact.state !== "confirmed") {
    throw new ParentConsentError(
      `Contact is ${contact.state}`,
      "invalid_state",
    );
  }

  await withdrawOperationalConsent(db, {
    clubSlug: contact.clubSlug,
    subjectId: contact.id,
    ipAddress,
  });

  // If a marketing grant exists, append a withdrawal using its withdraw token
  // when we have one; otherwise force marketingOptIn off and append via the
  // latest-record path by minting a synthetic withdrawal through latestConsent.
  const latestMarketing = await latestConsentRecord(db, {
    clubSlug: contact.clubSlug,
    subjectType: "player_contact",
    subjectId: contact.id,
    purpose: "marketing",
  });
  if (latestMarketing?.state === "granted" && latestMarketing.withdrawTokenHash) {
    // We do not have the plaintext marketing withdraw token here. Clear the
    // mirror and append a withdrawn row keyed off the grant id.
    await db
      .prepare(
        `INSERT INTO "consent_record"
           (id, clubSlug, subjectType, subjectId, purpose, channel, state,
            recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
         VALUES (?, ?, 'player_contact', ?, 'marketing', 'email', 'withdrawn',
                 ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        randomId("consent"),
        contact.clubSlug,
        contact.id,
        nowMs(),
        ipAddress,
        latestMarketing.policyVersion,
        latestMarketing.wordingHash,
        latestMarketing.id,
      )
      .run();
  }

  await db
    .prepare(
      `UPDATE "player_contact"
          SET state = 'withdrawn',
              operationalOptIn = 0,
              marketingOptIn = 0,
              withdrawnAt = ?,
              activationTokenHash = NULL,
              activationExpiresAt = NULL
        WHERE id = ? AND clubSlug = ?`,
    )
    .bind(nowMs(), contact.id, contact.clubSlug)
    .run();

  return { contactId: contact.id, clubSlug: contact.clubSlug };
}

