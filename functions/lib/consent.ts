import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import { hashWording, requestIp } from "./club-email-signoff";

/**
 * Marketing consent records (#75).
 *
 * Consent is the lawful basis only for club marketing (fundraising, sponsors,
 * shop). Membership and operational service messages use contract / legitimate
 * interests — they must not require a marketing consent tick.
 *
 * Bump MARKETING_CONSENT_POLICY_VERSION when editing MARKETING_CONSENT_WORDING.
 * Existing consent_record rows keep the version they were granted under.
 */

export const MARKETING_CONSENT_POLICY_VERSION = "1";

export const MARKETING_CONSENT_WORDING =
  "I agree that the club may email me about fundraising, sponsors, the club shop "
  + "and other non-essential promotions. I can withdraw this consent at any time "
  + "via the unsubscribe link in any marketing email. This is separate from "
  + "messages needed to run my membership (fixtures, safety, kit, subscriptions).";

export type ConsentSubjectType = "player_contact" | "user";
export type ConsentPurpose = "marketing";
export type ConsentChannel = "email";
export type ConsentState = "granted" | "withdrawn";

export type ConsentPolicySubmission = {
  policyVersion: string;
  wordingHash: string;
};

export type ConsentRecordRow = {
  id: string;
  clubSlug: string;
  subjectType: ConsentSubjectType;
  subjectId: string;
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  state: ConsentState;
  recordedAt: number;
  ipAddress: string | null;
  policyVersion: string;
  wordingHash: string;
  withdrawTokenHash: string | null;
  supersedesId: string | null;
};

export { hashWording, requestIp };

export async function currentMarketingConsentPolicy() {
  const wordingHash = await hashWording(MARKETING_CONSENT_WORDING);
  return {
    purpose: "marketing" as const,
    channel: "email" as const,
    policyVersion: MARKETING_CONSENT_POLICY_VERSION,
    wording: MARKETING_CONSENT_WORDING,
    wordingHash,
  };
}

export function parseConsentPolicy(raw: unknown): ConsentPolicySubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.policyVersion !== "string" || !obj.policyVersion) return null;
  if (typeof obj.wordingHash !== "string" || !obj.wordingHash) return null;
  return { policyVersion: obj.policyVersion, wordingHash: obj.wordingHash };
}

async function validateConsentPolicy(submission: ConsentPolicySubmission): Promise<void> {
  const expected = await currentMarketingConsentPolicy();
  if (
    submission.policyVersion !== expected.policyVersion
    || submission.wordingHash !== expected.wordingHash
  ) {
    throw new ConsentPolicyMismatchError();
  }
}

/** Latest consent row for a subject/purpose/channel, or null. */
export async function latestConsentRecord(
  db: D1Database,
  {
    clubSlug,
    subjectType,
    subjectId,
    purpose = "marketing",
    channel = "email",
  }: {
    clubSlug: string;
    subjectType: ConsentSubjectType;
    subjectId: string;
    purpose?: ConsentPurpose;
    channel?: ConsentChannel;
  },
): Promise<ConsentRecordRow | null> {
  return db
    .prepare(
      `SELECT id, clubSlug, subjectType, subjectId, purpose, channel, state,
              recordedAt, ipAddress, policyVersion, wordingHash,
              withdrawTokenHash, supersedesId
         FROM "consent_record"
        WHERE clubSlug = ? AND subjectType = ? AND subjectId = ?
          AND purpose = ? AND channel = ?
        ORDER BY recordedAt DESC
        LIMIT 1`,
    )
    .bind(clubSlug, subjectType, subjectId, purpose, channel)
    .first<ConsentRecordRow>();
}

/** True when the subject's latest marketing-email consent row is granted. */
export async function hasCurrentMarketingConsent(
  db: D1Database,
  clubSlug: string,
  subjectType: ConsentSubjectType,
  subjectId: string,
): Promise<boolean> {
  const latest = await latestConsentRecord(db, { clubSlug, subjectType, subjectId });
  return latest?.state === "granted";
}

function randomTokenHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  return hashWording(token);
}

/**
 * Record a marketing-email consent grant. Returns the plaintext withdraw token
 * once so a mailer can embed a one-click unsubscribe URL; only the hash is stored.
 * Syncs player_contact.marketingOptIn when the subject is a contact row.
 */
export async function recordMarketingConsentGrant(
  db: D1Database,
  {
    clubSlug,
    subjectType,
    subjectId,
    ipAddress,
    policy,
  }: {
    clubSlug: string;
    subjectType: ConsentSubjectType;
    subjectId: string;
    ipAddress: string | null;
    policy: ConsentPolicySubmission;
  },
): Promise<{ recordId: string; withdrawToken: string }> {
  await validateConsentPolicy(policy);

  const withdrawToken = randomTokenHex();
  const withdrawTokenHash = await hashToken(withdrawToken);
  const policyPayload = await currentMarketingConsentPolicy();
  const id = randomId("consent");
  const recordedAt = nowMs();

  await db
    .prepare(
      `INSERT INTO "consent_record"
         (id, clubSlug, subjectType, subjectId, purpose, channel, state,
          recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
       VALUES (?, ?, ?, ?, 'marketing', 'email', 'granted',
               ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      id,
      clubSlug,
      subjectType,
      subjectId,
      recordedAt,
      ipAddress,
      policyPayload.policyVersion,
      policyPayload.wordingHash,
      withdrawTokenHash,
    )
    .run();

  if (subjectType === "player_contact") {
    await db
      .prepare(
        `UPDATE "player_contact" SET marketingOptIn = 1
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(subjectId, clubSlug)
      .run();
  }

  return { recordId: id, withdrawToken };
}

/**
 * Withdraw marketing consent by one-click unsubscribe token.
 * Idempotent if already withdrawn. Syncs player_contact.marketingOptIn.
 */
export async function withdrawMarketingConsentByToken(
  db: D1Database,
  token: string,
  ipAddress: string | null,
): Promise<{ ok: true; clubSlug: string; subjectId: string } | { ok: false; reason: "not_found" }> {
  const tokenHash = await hashToken(token);
  const grant = await db
    .prepare(
      `SELECT id, clubSlug, subjectType, subjectId, purpose, channel, state,
              recordedAt, ipAddress, policyVersion, wordingHash,
              withdrawTokenHash, supersedesId
         FROM "consent_record"
        WHERE withdrawTokenHash = ? AND state = 'granted'
        ORDER BY recordedAt DESC
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<ConsentRecordRow>();

  if (!grant) {
    // Token may belong to an already-withdrawn grant — treat as success for
    // the caller so repeated clicks stay quiet (no enumeration of active grants).
    const any = await db
      .prepare(
        `SELECT clubSlug, subjectId FROM "consent_record"
          WHERE withdrawTokenHash = ? LIMIT 1`,
      )
      .bind(tokenHash)
      .first<{ clubSlug: string; subjectId: string }>();
    if (!any) return { ok: false, reason: "not_found" };
    return { ok: true, clubSlug: any.clubSlug, subjectId: any.subjectId };
  }

  const latest = await latestConsentRecord(db, {
    clubSlug: grant.clubSlug,
    subjectType: grant.subjectType,
    subjectId: grant.subjectId,
  });
  if (latest?.state === "withdrawn") {
    return { ok: true, clubSlug: grant.clubSlug, subjectId: grant.subjectId };
  }

  const id = randomId("consent");
  await db
    .prepare(
      `INSERT INTO "consent_record"
         (id, clubSlug, subjectType, subjectId, purpose, channel, state,
          recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
       VALUES (?, ?, ?, ?, 'marketing', 'email', 'withdrawn',
               ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      id,
      grant.clubSlug,
      grant.subjectType,
      grant.subjectId,
      nowMs(),
      ipAddress,
      grant.policyVersion,
      grant.wordingHash,
      grant.id,
    )
    .run();

  if (grant.subjectType === "player_contact") {
    await db
      .prepare(
        `UPDATE "player_contact" SET marketingOptIn = 0, withdrawnAt = ?
          WHERE id = ? AND clubSlug = ?`,
      )
      .bind(nowMs(), grant.subjectId, grant.clubSlug)
      .run();
  }

  return { ok: true, clubSlug: grant.clubSlug, subjectId: grant.subjectId };
}

/**
 * Build the unsubscribe path a mailer embeds. Absolute URL is the caller's job
 * (club origin). Token is the plaintext returned from recordMarketingConsentGrant.
 */
export function unsubscribePath(token: string): string {
  return `/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export class ConsentPolicyMismatchError extends Error {
  constructor() {
    super("The marketing consent policy changed; reload and review the current wording");
    this.name = "ConsentPolicyMismatchError";
  }
}
