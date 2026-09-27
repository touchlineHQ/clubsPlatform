import type { D1Database } from "@cloudflare/workers-types";
import { nowMs } from "./api-helpers";
import { writeAuditLog } from "./audit-log";

/**
 * Admin export / delete of a member's personal data at a club (#75 rights).
 *
 * Export returns the club-scoped bundle an admin can hand to a subject.
 * Delete purges Direct PII (contacts, consent, auth identity when safe) while
 * leaving blind membership assets (FAN, registrations, payments) that sit on
 * the contract basis — see docs/DATA_PROTECTION.md.
 */

export type MemberDataExport = {
  exportedAt: string;
  clubSlug: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: number;
  };
  players: Array<{ id: string; fanId: string; relationship: string }>;
  registrations: Array<{
    id: string;
    teamName: string;
    ageGroup: string | null;
    registrationStatus: string | null;
    registrationExpiry: string | null;
  }>;
  contacts: Array<{
    id: string;
    playerId: string;
    email: string;
    relationship: string;
    state: string;
    operationalOptIn: number;
    marketingOptIn: number;
  }>;
  consentRecords: Array<{
    id: string;
    subjectType: string;
    subjectId: string;
    purpose: string;
    channel: string;
    state: string;
    recordedAt: number;
    policyVersion: string;
  }>;
  teamRoles: Array<{
    id: string;
    teamSlug: string;
    teamLeague: string;
    teamName: string;
    role: string;
  }>;
  bookingRequests: Array<{
    id: string;
    teamName: string;
    date: string;
    status: string;
  }>;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  clubSlug: string | null;
  createdAt: number;
};

async function loadUserInClub(
  db: D1Database,
  clubSlug: string,
  userId: string,
): Promise<UserRow | null> {
  // Club-bound users match on clubSlug. Platform superadmins (clubSlug null)
  // are not members of a club and cannot be exported/deleted via this path.
  return db
    .prepare(
      `SELECT id, name, email, role, clubSlug, createdAt FROM "user"
        WHERE id = ? AND clubSlug = ?`,
    )
    .bind(userId, clubSlug)
    .first<UserRow>();
}

export async function exportMemberData(
  db: D1Database,
  clubSlug: string,
  userId: string,
): Promise<MemberDataExport | null> {
  const user = await loadUserInClub(db, clubSlug, userId);
  if (!user) return null;

  const players = (await db
    .prepare(
      `SELECT p.id, p.fanId, up.relationship
         FROM "user_player" up
         JOIN "player" p ON p.id = up.playerId
        WHERE up.userId = ?`,
    )
    .bind(userId)
    .all<{ id: string; fanId: string; relationship: string }>()).results ?? [];

  const playerIds = players.map((p) => p.id);
  let registrations: MemberDataExport["registrations"] = [];
  let contacts: MemberDataExport["contacts"] = [];

  if (playerIds.length > 0) {
    const placeholders = playerIds.map(() => "?").join(",");
    registrations = (await db
      .prepare(
        `SELECT id, teamName, ageGroup, registrationStatus, registrationExpiry
           FROM "player_registration"
          WHERE clubSlug = ? AND playerId IN (${placeholders})`,
      )
      .bind(clubSlug, ...playerIds)
      .all<MemberDataExport["registrations"][number]>()).results ?? [];

    contacts = (await db
      .prepare(
        `SELECT id, playerId, email, relationship, state, operationalOptIn, marketingOptIn
           FROM "player_contact"
          WHERE clubSlug = ? AND playerId IN (${placeholders})`,
      )
      .bind(clubSlug, ...playerIds)
      .all<MemberDataExport["contacts"][number]>()).results ?? [];
  }

  // Also pull contacts whose email matches the user's email at this club
  // (import-created rows may not yet share a user_player path the admin expects).
  const emailContacts = (await db
    .prepare(
      `SELECT id, playerId, email, relationship, state, operationalOptIn, marketingOptIn
         FROM "player_contact"
        WHERE clubSlug = ? AND lower(email) = lower(?)`,
    )
    .bind(clubSlug, user.email)
    .all<MemberDataExport["contacts"][number]>()).results ?? [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  for (const c of emailContacts) contactById.set(c.id, c);
  contacts = [...contactById.values()];

  const contactIds = contacts.map((c) => c.id);
  let consentRecords: MemberDataExport["consentRecords"] = [];
  if (contactIds.length > 0) {
    const placeholders = contactIds.map(() => "?").join(",");
    consentRecords = (await db
      .prepare(
        `SELECT id, subjectType, subjectId, purpose, channel, state, recordedAt, policyVersion
           FROM "consent_record"
          WHERE clubSlug = ?
            AND (
              (subjectType = 'user' AND subjectId = ?)
              OR (subjectType = 'player_contact' AND subjectId IN (${placeholders}))
            )
          ORDER BY recordedAt ASC`,
      )
      .bind(clubSlug, userId, ...contactIds)
      .all<MemberDataExport["consentRecords"][number]>()).results ?? [];
  } else {
    consentRecords = (await db
      .prepare(
        `SELECT id, subjectType, subjectId, purpose, channel, state, recordedAt, policyVersion
           FROM "consent_record"
          WHERE clubSlug = ? AND subjectType = 'user' AND subjectId = ?
          ORDER BY recordedAt ASC`,
      )
      .bind(clubSlug, userId)
      .all<MemberDataExport["consentRecords"][number]>()).results ?? [];
  }

  const teamRoles = (await db
    .prepare(
      `SELECT id, teamSlug, teamLeague, teamName, role FROM "user_team_role"
        WHERE userId = ? AND (clubSlug = ? OR clubSlug IS NULL)`,
    )
    .bind(userId, clubSlug)
    .all<MemberDataExport["teamRoles"][number]>()).results ?? [];

  const bookingRequests = (await db
    .prepare(
      `SELECT id, teamName, date, status FROM "booking_request"
        WHERE userId = ? AND (clubSlug = ? OR clubSlug IS NULL)`,
    )
    .bind(userId, clubSlug)
    .all<MemberDataExport["bookingRequests"][number]>()).results ?? [];

  return {
    exportedAt: new Date().toISOString(),
    clubSlug,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
    players,
    registrations,
    contacts,
    consentRecords,
    teamRoles,
    bookingRequests,
  };
}

export type MemberDeleteResult = {
  deletedContacts: number;
  deletedConsentRecords: number;
  deletedTeamRoles: number;
  anonymisedUser: boolean;
};

/**
 * Purge Direct PII for a member at this club. Blind FAN / registration /
 * payment rows are retained (contract basis). Audit note must not contain
 * the deleted address.
 */
export async function deleteMemberData(
  db: D1Database,
  {
    clubSlug,
    userId,
    adminId,
  }: {
    clubSlug: string;
    userId: string;
    adminId: string;
  },
): Promise<MemberDeleteResult | null> {
  const user = await loadUserInClub(db, clubSlug, userId);
  if (!user) return null;

  // Refuse to erase the last admin of the club via this path.
  if (user.role === "admin") {
    const adminCount = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM "user" WHERE clubSlug = ? AND role = 'admin'`,
      )
      .bind(clubSlug)
      .first<{ n: number }>();
    if ((adminCount?.n ?? 0) <= 1) {
      throw new LastAdminDeleteError();
    }
  }

  const bundle = await exportMemberData(db, clubSlug, userId);
  if (!bundle) return null;

  const contactIds = bundle.contacts.map((c) => c.id);
  let deletedContacts = 0;
  let deletedConsentRecords = 0;

  if (contactIds.length > 0) {
    const placeholders = contactIds.map(() => "?").join(",");
    const consentDel = await db
      .prepare(
        `DELETE FROM "consent_record"
          WHERE clubSlug = ?
            AND (
              (subjectType = 'user' AND subjectId = ?)
              OR (subjectType = 'player_contact' AND subjectId IN (${placeholders}))
            )`,
      )
      .bind(clubSlug, userId, ...contactIds)
      .run();
    deletedConsentRecords = consentDel.meta?.changes ?? 0;

    const contactDel = await db
      .prepare(
        `DELETE FROM "player_contact"
          WHERE clubSlug = ? AND id IN (${placeholders})`,
      )
      .bind(clubSlug, ...contactIds)
      .run();
    deletedContacts = contactDel.meta?.changes ?? 0;
  } else {
    const consentDel = await db
      .prepare(
        `DELETE FROM "consent_record"
          WHERE clubSlug = ? AND subjectType = 'user' AND subjectId = ?`,
      )
      .bind(clubSlug, userId)
      .run();
    deletedConsentRecords = consentDel.meta?.changes ?? 0;
  }

  const rolesDel = await db
    .prepare(
      `DELETE FROM "user_team_role"
        WHERE userId = ? AND (clubSlug = ? OR clubSlug IS NULL)`,
    )
    .bind(userId, clubSlug)
    .run();

  // Anonymise the auth identity at this club rather than hard-deleting — the
  // user row may still own sessions; FAN links stay for membership continuity.
  const tombstoneEmail = `deleted+${userId}@invalid.touchlinehq.local`;
  await db
    .prepare(
      `UPDATE "user" SET name = '', email = ?, updatedAt = ?
        WHERE id = ? AND clubSlug = ?`,
    )
    .bind(tombstoneEmail, nowMs(), userId, clubSlug)
    .run();

  await writeAuditLog(db, {
    clubSlug,
    adminId,
    action: "member_data_deleted",
    targetTable: "user",
    targetId: userId,
    note: `contacts=${deletedContacts};consent=${deletedConsentRecords}`,
  });

  return {
    deletedContacts,
    deletedConsentRecords,
    deletedTeamRoles: rolesDel.meta?.changes ?? 0,
    anonymisedUser: true,
  };
}

export class LastAdminDeleteError extends Error {
  constructor() {
    super("Cannot delete the last admin of this club");
    this.name = "LastAdminDeleteError";
  }
}
