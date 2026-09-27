import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import { hashWording } from "./club-email-signoff";

/**
 * Processor agreement (DPA) acceptance (#75 / UK GDPR Art. 28).
 *
 * The club is the controller; touchlineHQ is the processor. Club signup must
 * record acceptance of a versioned DPA before the club can use the platform.
 *
 * Bump DPA_POLICY_VERSION when editing DPA_WORDING. Existing acceptances keep
 * the version they were accepted under.
 */

export const DPA_POLICY_VERSION = "1";

export const DPA_WORDING =
  "I am authorised to act for this club. I accept that the club is the data "
  + "controller of members' and contacts' personal data, and that touchlineHQ "
  + "acts only as a processor on the club's documented instructions. touchlineHQ "
  + "will not use parent or member contact data for its own marketing. The club "
  + "is responsible for its lawful basis, privacy notice, retention, and for "
  + "paying any ICO data-protection fee that applies. Full processor terms are "
  + "available from touchlineHQ on request.";

export type DpaPolicySubmission = {
  accepted: true;
  policyVersion: string;
  wordingHash: string;
};

export async function currentDpaPolicy() {
  return {
    policyVersion: DPA_POLICY_VERSION,
    wording: DPA_WORDING,
    wordingHash: await hashWording(DPA_WORDING),
    icoFeeNote:
      "Most UK clubs that process personal data need to pay the ICO data protection fee. "
      + "Check https://ico.org.uk/for-organisations/data-protection-fee/ before go-live.",
  };
}

export function parseDpaAcceptance(raw: unknown): DpaPolicySubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.accepted !== true) return null;
  if (typeof obj.policyVersion !== "string" || !obj.policyVersion) return null;
  if (typeof obj.wordingHash !== "string" || !obj.wordingHash) return null;
  return {
    accepted: true,
    policyVersion: obj.policyVersion,
    wordingHash: obj.wordingHash,
  };
}

export async function validateDpaSubmission(submission: DpaPolicySubmission): Promise<void> {
  const expected = await currentDpaPolicy();
  if (
    submission.policyVersion !== expected.policyVersion
    || submission.wordingHash !== expected.wordingHash
  ) {
    throw new DpaPolicyMismatchError();
  }
}

export async function hasCurrentDpaAcceptance(
  db: D1Database,
  clubSlug: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM "club_dpa_acceptance"
        WHERE clubSlug = ? AND policyVersion = ?`,
    )
    .bind(clubSlug, DPA_POLICY_VERSION)
    .first<{ id: string }>();
  return !!row;
}

/**
 * Record DPA acceptance under the current policy version.
 * Idempotent when the club already holds the current version.
 */
export async function recordDpaAcceptance(
  db: D1Database,
  {
    clubSlug,
    userId,
    ipAddress,
    policy,
  }: {
    clubSlug: string;
    userId: string;
    ipAddress: string | null;
    policy: DpaPolicySubmission;
  },
): Promise<{ acceptanceId: string; alreadyHeld: boolean }> {
  await validateDpaSubmission(policy);

  if (await hasCurrentDpaAcceptance(db, clubSlug)) {
    const existing = await db
      .prepare(
        `SELECT id FROM "club_dpa_acceptance"
          WHERE clubSlug = ? AND policyVersion = ?`,
      )
      .bind(clubSlug, DPA_POLICY_VERSION)
      .first<{ id: string }>();
    return { acceptanceId: existing!.id, alreadyHeld: true };
  }

  const id = randomId("dpa");
  const expected = await currentDpaPolicy();
  await db
    .prepare(
      `INSERT INTO "club_dpa_acceptance"
         (id, clubSlug, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clubSlug, policyVersion) DO NOTHING`,
    )
    .bind(
      id,
      clubSlug,
      userId,
      nowMs(),
      ipAddress,
      expected.policyVersion,
      expected.wordingHash,
    )
    .run();

  const held = await db
    .prepare(
      `SELECT id FROM "club_dpa_acceptance"
        WHERE clubSlug = ? AND policyVersion = ?`,
    )
    .bind(clubSlug, DPA_POLICY_VERSION)
    .first<{ id: string }>();
  if (!held) throw new Error("Failed to record DPA acceptance");
  return { acceptanceId: held.id, alreadyHeld: false };
}

export class DpaPolicyMismatchError extends Error {
  constructor() {
    super("The processor agreement changed; reload the page and review the current wording");
    this.name = "DpaPolicyMismatchError";
  }
}
