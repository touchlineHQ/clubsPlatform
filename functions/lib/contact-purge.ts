import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import { prepareAuditLog } from "./audit-log";
import { hashWording } from "./club-email-signoff";

/**
 * One-click contact email purge (#134).
 *
 * Hard-deletes player_contact (and related consent_record rows), records a
 * salted hash so FA import cannot silently re-add the address, and writes an
 * admin_audit_log entry that never contains the plaintext email. Leaves FAN,
 * registration, team, payment history, and any real parent user/login alone.
 */

/** Current hash material version; bump if salt rotation is required. */
export const CONTACT_SUPPRESSION_HASH_VERSION = 1;

/** Salt material for the current hash version (stored on each suppression row). */
export const CONTACT_SUPPRESSION_SALT_V1 = "contact-suppression-v1";

export type ContactPurgeActor = {
  /** Acting user id (admin or parent). Stored in admin_audit_log.adminId. */
  actorId: string;
  /** Distinguishes audit action / note without recording the address. */
  source: "admin" | "parent" | "admin_bulk_team" | "admin_bulk_club";
};

export type ContactPurgeResult = {
  contactId: string;
  playerId: string;
  clubSlug: string;
};

export class ContactPurgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "invalid_email"
      | "suppressed"
      | "forbidden",
  ) {
    super(message);
    this.name = "ContactPurgeError";
  }
}

/** Lowercase + trim; null when empty or clearly not an email. */
export function normalizeContactEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Salted SHA-256 hex digest of a club-scoped normalised address.
 * Never store or log the plaintext email alongside this hash.
 */
export async function hashContactEmailForSuppression(
  clubSlug: string,
  email: string,
  {
    salt = CONTACT_SUPPRESSION_SALT_V1,
    hashVersion = CONTACT_SUPPRESSION_HASH_VERSION,
  }: { salt?: string; hashVersion?: number } = {},
): Promise<{ emailHash: string; salt: string; hashVersion: number }> {
  const normalised = normalizeContactEmail(email);
  if (!normalised) {
    throw new ContactPurgeError("email is invalid", "invalid_email");
  }
  const emailHash = await hashWording(
    `${hashVersion}\0${salt}\0${clubSlug}\0${normalised}`,
  );
  return { emailHash, salt, hashVersion };
}

/** True when this club has a suppression row for the address under the current hash version. */
export async function isEmailSuppressed(
  db: D1Database,
  clubSlug: string,
  email: string,
): Promise<boolean> {
  const normalised = normalizeContactEmail(email);
  if (!normalised) return false;
  const { emailHash } = await hashContactEmailForSuppression(clubSlug, normalised);
  const row = await db
    .prepare(
      `SELECT id FROM "contact_email_suppression"
        WHERE clubSlug = ? AND emailHash = ?`,
    )
    .bind(clubSlug, emailHash)
    .first<{ id: string }>();
  return !!row;
}

/** Remove a suppression so an admin can explicitly re-add the address. */
export async function clearEmailSuppression(
  db: D1Database,
  clubSlug: string,
  email: string,
): Promise<boolean> {
  const normalised = normalizeContactEmail(email);
  if (!normalised) return false;
  const { emailHash } = await hashContactEmailForSuppression(clubSlug, normalised);
  const result = await db
    .prepare(
      `DELETE FROM "contact_email_suppression"
        WHERE clubSlug = ? AND emailHash = ?`,
    )
    .bind(clubSlug, emailHash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

type ContactRow = {
  id: string;
  clubSlug: string;
  playerId: string;
  email: string;
};

function auditActionFor(source: ContactPurgeActor["source"]): string {
  switch (source) {
    case "parent":
      return "contact_purged_by_parent";
    case "admin_bulk_team":
      return "contact_purged_bulk_team";
    case "admin_bulk_club":
      return "contact_purged_bulk_club";
    default:
      return "contact_purged";
  }
}

/**
 * Hard-delete one player_contact, scrub related consent, suppress the address,
 * and audit — without touching user/account/FAN/registration/payment rows.
 */
export async function purgePlayerContact(
  db: D1Database,
  {
    clubSlug,
    contactId,
    actor,
  }: {
    clubSlug: string;
    contactId: string;
    actor: ContactPurgeActor;
  },
): Promise<ContactPurgeResult | null> {
  const contact = await db
    .prepare(
      `SELECT id, clubSlug, playerId, email FROM "player_contact"
        WHERE id = ? AND clubSlug = ?`,
    )
    .bind(contactId, clubSlug)
    .first<ContactRow>();
  if (!contact) return null;

  const consentDelete = db
    .prepare(
      `DELETE FROM "consent_record"
        WHERE clubSlug = ?
          AND subjectType = 'player_contact'
          AND subjectId = ?`,
    )
    .bind(clubSlug, contact.id);

  const contactDelete = db
    .prepare(
      `DELETE FROM "player_contact" WHERE id = ? AND clubSlug = ?`,
    )
    .bind(contact.id, clubSlug);

  // Legacy imports may contain invalid addresses. They must still be deleted,
  // even though they cannot be hashed by the suppression normalizer.
  const statements = [consentDelete, contactDelete];
  if (normalizeContactEmail(contact.email)) {
    const { emailHash, salt, hashVersion } = await hashContactEmailForSuppression(
      clubSlug,
      contact.email,
    );
    // Keep an earlier suppression for the same address at this club.
    statements.push(db
      .prepare(
        `INSERT OR IGNORE INTO "contact_email_suppression"
           (id, clubSlug, emailHash, salt, hashVersion, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(randomId("cesup"), clubSlug, emailHash, salt, hashVersion, nowMs()));
  }

  const audit = prepareAuditLog(db, {
    clubSlug,
    adminId: actor.actorId,
    action: auditActionFor(actor.source),
    targetTable: "player_contact",
    targetId: contact.id,
    // Player id only — never the deleted address.
    note: `playerId=${contact.playerId};source=${actor.source}`,
  });

  await db.batch([...statements, audit]);

  return {
    contactId: contact.id,
    playerId: contact.playerId,
    clubSlug,
  };
}

/** Purge every contact attached to players registered on a team at this club. */
export async function purgeContactsForTeam(
  db: D1Database,
  {
    clubSlug,
    teamName,
    actorId,
  }: {
    clubSlug: string;
    teamName: string;
    actorId: string;
  },
): Promise<ContactPurgeResult[]> {
  const trimmed = teamName.trim();
  if (!trimmed) return [];

  const contacts = (await db
    .prepare(
      `SELECT DISTINCT pc.id AS id
         FROM "player_contact" pc
         JOIN "player_registration" pr
           ON pr.playerId = pc.playerId AND pr.clubSlug = pc.clubSlug
        WHERE pc.clubSlug = ?
          AND pr.teamName = ? COLLATE NOCASE`,
    )
    .bind(clubSlug, trimmed)
    .all<{ id: string }>()).results ?? [];

  const purged: ContactPurgeResult[] = [];
  for (const row of contacts) {
    const result = await purgePlayerContact(db, {
      clubSlug,
      contactId: row.id,
      actor: { actorId, source: "admin_bulk_team" },
    });
    if (result) purged.push(result);
  }
  return purged;
}

/** Purge every player_contact row at this club. */
export async function purgeContactsForClub(
  db: D1Database,
  {
    clubSlug,
    actorId,
  }: {
    clubSlug: string;
    actorId: string;
  },
): Promise<ContactPurgeResult[]> {
  const contacts = (await db
    .prepare(
      `SELECT id FROM "player_contact" WHERE clubSlug = ?`,
    )
    .bind(clubSlug)
    .all<{ id: string }>()).results ?? [];

  const purged: ContactPurgeResult[] = [];
  for (const row of contacts) {
    const result = await purgePlayerContact(db, {
      clubSlug,
      contactId: row.id,
      actor: { actorId, source: "admin_bulk_club" },
    });
    if (result) purged.push(result);
  }
  return purged;
}

/**
 * Parent self-purge: hard-delete every contact at the club whose email matches
 * the parent's login email. Does not delete the user / account.
 */
export async function purgeContactsMatchingEmail(
  db: D1Database,
  {
    clubSlug,
    email,
    actorId,
    source = "parent",
  }: {
    clubSlug: string;
    email: string;
    actorId: string;
    source?: ContactPurgeActor["source"];
  },
): Promise<ContactPurgeResult[]> {
  const normalised = normalizeContactEmail(email);
  if (!normalised) {
    throw new ContactPurgeError("email is invalid", "invalid_email");
  }

  const contacts = (await db
    .prepare(
      `SELECT id FROM "player_contact"
        WHERE clubSlug = ? AND lower(email) = ?`,
    )
    .bind(clubSlug, normalised)
    .all<{ id: string }>()).results ?? [];

  const purged: ContactPurgeResult[] = [];
  for (const row of contacts) {
    const result = await purgePlayerContact(db, {
      clubSlug,
      contactId: row.id,
      actor: { actorId, source },
    });
    if (result) purged.push(result);
  }
  return purged;
}
