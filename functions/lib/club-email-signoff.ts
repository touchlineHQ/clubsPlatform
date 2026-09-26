import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";

/**
 * Three-liability club email sign-off (#130 / epic #128).
 *
 * The club is the controller; we are the processor. Before any contact address
 * is collected, the club must independently accept each liability below. A
 * bundled "accept all" is not valid evidence — each tick is recorded as its
 * own row with the policy version and a hash of the exact wording shown.
 *
 * Bump EMAIL_SIGNOFF_POLICY_VERSION when editing any liability's wording.
 * Existing rows keep the version they were accepted under; a club whose
 * acceptances predate the current version is treated as unsigned for new
 * collection until it re-accepts.
 */

export const EMAIL_SIGNOFF_POLICY_VERSION = "1";

export const EMAIL_SIGNOFF_LIABILITIES = {
  parental_consent: {
    id: "parental_consent" as const,
    title: "Verified parental consent for communication",
    wording:
      "I certify that the club has obtained verifiable parental/guardian consent "
      + "to share each contact address with Touchline HQ as a third-party processor "
      + "for club administration and communications.",
  },
  operational_split: {
    id: "operational_split" as const,
    title: "Operational vs marketing split",
    wording:
      "I certify that the club will use these addresses only for necessary grassroots "
      + "club administration (fixtures, safety, kit sizing and similar) unless the "
      + "parent has separately opted into marketing.",
  },
  right_to_object: {
    id: "right_to_object" as const,
    title: "Right to object / unsubscribe",
    wording:
      "I certify that if a parent demands removal of an address, the club will purge "
      + "it immediately or instruct Touchline HQ to do so.",
  },
} as const;

export type EmailSignoffLiabilityId = keyof typeof EMAIL_SIGNOFF_LIABILITIES;

export const EMAIL_SIGNOFF_LIABILITY_IDS = Object.keys(
  EMAIL_SIGNOFF_LIABILITIES,
) as EmailSignoffLiabilityId[];

export type EmailSignoffTicks = Record<EmailSignoffLiabilityId, boolean>;

/** SHA-256 hex digest of the exact wording string shown for a liability. */
export async function hashWording(wording: string): Promise<string> {
  const bytes = new TextEncoder().encode(wording);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Client IP as Cloudflare (or a reverse proxy) saw it. */
export function requestIp(request: Request): string | null {
  return (
    request.headers.get("CF-Connecting-IP")
    || request.headers.get("True-Client-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || null
  );
}

/** Policy payload the UI renders so the wording hash matches what was shown. */
export async function currentPolicyPayload() {
  const liabilities = await Promise.all(
    EMAIL_SIGNOFF_LIABILITY_IDS.map(async (id) => {
      const entry = EMAIL_SIGNOFF_LIABILITIES[id];
      return {
        id,
        title: entry.title,
        wording: entry.wording,
        wordingHash: await hashWording(entry.wording),
      };
    }),
  );
  return {
    policyVersion: EMAIL_SIGNOFF_POLICY_VERSION,
    liabilities,
  };
}

/**
 * True when the club has accepted every liability under the current policy
 * version. Partial acceptance, or acceptance under an older wording, is false.
 */
export async function hasCurrentEmailSignoff(
  db: D1Database,
  clubSlug: string,
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT liability FROM "club_email_signoff"
        WHERE clubSlug = ? AND policyVersion = ?`,
    )
    .bind(clubSlug, EMAIL_SIGNOFF_POLICY_VERSION)
    .all<{ liability: string }>();

  const held = new Set((results ?? []).map((r) => r.liability));
  return EMAIL_SIGNOFF_LIABILITY_IDS.every((id) => held.has(id));
}

/** Acceptance group id for the club's current-version sign-off, or null. */
export async function currentSignoffAcceptanceId(
  db: D1Database,
  clubSlug: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT acceptanceId FROM "club_email_signoff"
        WHERE clubSlug = ? AND policyVersion = ?
        LIMIT 1`,
    )
    .bind(clubSlug, EMAIL_SIGNOFF_POLICY_VERSION)
    .first<{ acceptanceId: string }>();
  if (!row) return null;
  if (!(await hasCurrentEmailSignoff(db, clubSlug))) return null;
  return row.acceptanceId;
}

/**
 * Which liabilities the club has accepted under the current version.
 * Used by the Customise prompt so a partial accept can resume.
 */
export async function currentAcceptedLiabilities(
  db: D1Database,
  clubSlug: string,
): Promise<EmailSignoffLiabilityId[]> {
  const { results } = await db
    .prepare(
      `SELECT liability FROM "club_email_signoff"
        WHERE clubSlug = ? AND policyVersion = ?`,
    )
    .bind(clubSlug, EMAIL_SIGNOFF_POLICY_VERSION)
    .all<{ liability: string }>();

  return (results ?? [])
    .map((r) => r.liability)
    .filter((id): id is EmailSignoffLiabilityId =>
      EMAIL_SIGNOFF_LIABILITY_IDS.includes(id as EmailSignoffLiabilityId),
    );
}

/**
 * Record an acceptance of every liability under the current policy version.
 * Requires all three ticks — no bundled accept-all shortcut on the server.
 * Idempotent for a club that already holds the current version.
 */
export async function recordEmailSignoff(
  db: D1Database,
  {
    clubSlug,
    userId,
    ipAddress,
    ticks,
  }: {
    clubSlug: string;
    userId: string;
    ipAddress: string | null;
    ticks: EmailSignoffTicks;
  },
): Promise<{ acceptanceId: string; alreadyHeld: boolean }> {
  for (const id of EMAIL_SIGNOFF_LIABILITY_IDS) {
    if (ticks[id] !== true) {
      throw new SignoffIncompleteError(id);
    }
  }

  if (await hasCurrentEmailSignoff(db, clubSlug)) {
    const existing = await currentSignoffAcceptanceId(db, clubSlug);
    return { acceptanceId: existing!, alreadyHeld: true };
  }

  const acceptanceId = randomId("emsign");
  const acceptedAt = nowMs();
  const policyVersion = EMAIL_SIGNOFF_POLICY_VERSION;

  for (const id of EMAIL_SIGNOFF_LIABILITY_IDS) {
    const wordingHash = await hashWording(EMAIL_SIGNOFF_LIABILITIES[id].wording);
    await db
      .prepare(
        `INSERT INTO "club_email_signoff"
           (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(clubSlug, liability, policyVersion) DO NOTHING`,
      )
      .bind(
        randomId("emsignrow"),
        acceptanceId,
        clubSlug,
        id,
        userId,
        acceptedAt,
        ipAddress,
        policyVersion,
        wordingHash,
      )
      .run();
  }

  // A concurrent accept may have won the UNIQUE race with a different
  // acceptanceId. Re-read so callers stamp player_contact with the held one.
  const held = await currentSignoffAcceptanceId(db, clubSlug);
  if (!held) {
    throw new Error("Failed to record email sign-off");
  }
  return { acceptanceId: held, alreadyHeld: false };
}

export class SignoffIncompleteError extends Error {
  liability: EmailSignoffLiabilityId;
  constructor(liability: EmailSignoffLiabilityId) {
    super(`Liability ${liability} must be independently accepted`);
    this.name = "SignoffIncompleteError";
    this.liability = liability;
  }
}

/** Validate a register/accept body into three independent ticks. */
export function parseSignoffTicks(raw: unknown): EmailSignoffTicks | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const ticks = {} as EmailSignoffTicks;
  for (const id of EMAIL_SIGNOFF_LIABILITY_IDS) {
    if (obj[id] !== true) return null;
    ticks[id] = true;
  }
  // Reject a sneaky acceptAll that the client might send alongside.
  if ("acceptAll" in obj && obj.acceptAll === true) {
    // Presence alone is fine only if each liability is still independently true
    // (already checked). We do not treat acceptAll as a substitute.
  }
  return ticks;
}
