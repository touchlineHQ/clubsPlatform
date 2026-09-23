import { type Env, json, requireAuth, requireAdmin, getClubSlug, isMultiClubMode } from "../lib/api-helpers";
import { subscriptionLevelJoinSql } from "../lib/registration-merge";
import { GC_BLOCKING_STATUSES } from "../lib/payment-status";

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
  // Attached by attachMergeGrouping, and only to the rows in a billing group —
  // a club that has merged nothing sends none of these at all.
  /** The registration whose payment covers this one. Absent means itself. */
  billingRegistrationId?: string;
  /** This registration's primary's team, when it is a secondary. */
  billedWithTeamName?: string;
  /** The other teams this registration is billed for, when it is a primary. */
  mergedTeamNames?: string;
  manualPaidBy?: string | null;
  manualPaidAt?: number | null;
  manualNote?: string | null;
}

/**
 * Collapses a registration's player_payment rows into the single status the UI
 * shows.
 *
 * Ordered most-live-first:
 *
 * - `active` stays top. Registrations are reused across seasons (they are
 *   unique on club + player + team), so a player carrying last season's
 *   completed plan alongside this season's live subscription is *currently
 *   paying*, and that is the more useful fact.
 * - `completed` (every payment of a count-limited plan collected) outranks
 *   `mandate_only` and `inactive`: an abandoned setup attempt or a spent
 *   mandate sitting beside a finished plan must not mask "paid in full".
 * - `completed` outranks `manual` because the GoCardless record is the stronger
 *   evidence. New overlaps are blocked by api/admin/manual-payment.ts, so this
 *   only decides legacy rows.
 *
 * `manual` is an admin override (see api/admin/manual-payment.ts). Player-facing
 * responses fold it into `completed`, so a manually-paid player is
 * indistinguishable from someone who has paid GoCardless in full — the ticket
 * asks for them to "show as fully paid up". The admin response keeps it distinct
 * so the override, and who made it, stays visible to the club.
 */
function paymentStatusSubquery(distinguishManual: boolean): string {
  const manualBranch = distinguishManual ? `'manual'` : `'completed'`;
  // Keyed on the row's own id. A merged registration takes its group's status in
  // attachMergeGrouping below, not here: resolving it in SQL meant a subquery per
  // row inside a subquery per row, for a table that holds a handful of rows.
  return `(
  SELECT CASE
    WHEN SUM(CASE WHEN pp.status = 'active' THEN 1 ELSE 0 END) > 0 THEN 'active'
    WHEN SUM(CASE WHEN pp.status = 'completed' THEN 1 ELSE 0 END) > 0 THEN 'completed'
    WHEN SUM(CASE WHEN pp.status = 'manual' THEN 1 ELSE 0 END) > 0 THEN ${manualBranch}
    WHEN SUM(CASE WHEN pp.status = 'mandate_only' THEN 1 ELSE 0 END) > 0 THEN 'pending'
    WHEN COUNT(pp.id) > 0 THEN 'inactive'
    ELSE NULL
  END
  FROM "player_payment" pp WHERE pp.registrationId = pr.id
) AS paymentStatus`;
}

const PERSONAL_PAYMENT_STATUS_SUBQUERY = paymentStatusSubquery(false);
const CLUB_PAYMENT_STATUS_SUBQUERY = paymentStatusSubquery(true);

interface ManualAttributionRow {
  /** The registration the manual row hangs off — a group's primary. */
  registrationId: string;
  manualPaidBy: string | null;
  manualPaidAt: number;
  manualNote: string | null;
}

interface MergeRow {
  registrationId: string;
  primaryRegistrationId: string;
}

/**
 * Reads back who marked each manual payment as paid, from the audit log written
 * by api/admin/manual-payment.ts. Kept out of the main query — one extra lookup
 * beats three correlated subqueries, and it is skipped entirely when the club
 * has no manual overrides.
 */
async function attachManualAttribution(
  db: D1Database,
  clubSlug: string,
  rows: RegistrationRow[],
  /** Secondary → primary, so a merged row finds the override on its group. */
  primaryOf: Map<string, string>,
): Promise<RegistrationRow[]> {
  if (!rows.some((r) => r.paymentStatus === "manual")) return rows;

  const { results } = await db
    .prepare(
      `SELECT pp.registrationId,
              u.email      AS manualPaidBy,
              al.createdAt AS manualPaidAt,
              al.note      AS manualNote
         FROM "admin_audit_log" al
         JOIN "player_payment" pp ON pp.id = al.targetId
         LEFT JOIN "user" u ON u.id = al.adminId
        WHERE al.clubSlug = ?
          AND al.targetTable = 'player_payment'
          AND al.action = 'manual_paid'
          AND pp.status = 'manual'
        ORDER BY al.createdAt DESC`
    )
    .bind(clubSlug)
    .all<ManualAttributionRow>();

  // Ordered newest-first, so the first hit per registration is the override
  // currently in force — a registration re-marked after an undo has several.
  const latest = new Map<string, ManualAttributionRow>();
  for (const row of results) {
    if (!latest.has(row.registrationId)) latest.set(row.registrationId, row);
  }

  return rows.map((r) => {
    const attribution = r.paymentStatus === "manual"
      ? latest.get(primaryOf.get(r.registrationId) ?? r.registrationId)
      : undefined;
    return attribution
      ? {
          ...r,
          manualPaidBy: attribution.manualPaidBy,
          manualPaidAt: attribution.manualPaidAt,
          manualNote: attribution.manualNote,
        }
      : r;
  });
}

/**
 * Reads the club's billing groups and attaches them to the rows that are in one.
 *
 * Deliberately one small query and a pass in JS rather than SQL per row:
 * `registration_merge` holds one row per merged *secondary*, so it is nearly
 * empty, and asking for it per registration meant three correlated subqueries on
 * every row of a whole-club scan — plus a `billingRegistrationId` on the wire for
 * every row that repeated the id it already had, which grew the response by 25%.
 * It is also the rule this file already follows for manual attribution.
 *
 * Returns the secondary → primary map, which manual attribution needs too.
 */
async function attachMergeGrouping(
  db: D1Database,
  clubSlug: string,
  rowSets: RegistrationRow[][],
): Promise<Map<string, string>> {
  const { results: merges } = await db
    .prepare(
      `SELECT rm."registrationId", rm."primaryRegistrationId", pr."teamName"
         FROM "registration_merge" rm
         JOIN "player_registration" pr ON pr."id" = rm."registrationId"
        WHERE rm."clubSlug" = ?`
    )
    .bind(clubSlug)
    .all<MergeRow & { teamName: string }>();

  const primaryOf = new Map(merges.map((m) => [m.registrationId, m.primaryRegistrationId]));
  // Every club that has merged nothing stops here, having paid one empty read.
  if (primaryOf.size === 0) return primaryOf;

  const teamNameById = new Map<string, string>();
  const membersOf = new Map<string, string[]>();
  for (const rows of rowSets) {
    for (const r of rows) teamNameById.set(r.registrationId, r.teamName);
  }
  for (const m of merges) {
    teamNameById.set(m.registrationId, m.teamName);
    const members = membersOf.get(m.primaryRegistrationId);
    if (members) members.push(m.registrationId);
    else membersOf.set(m.primaryRegistrationId, [m.registrationId]);
  }

  // A group's payment hangs off its primary, so every member reports that status.
  const statusByPrimary = new Map<string, string | null>();
  for (const rows of rowSets) {
    for (const r of rows) {
      if (membersOf.has(r.registrationId)) statusByPrimary.set(r.registrationId, r.paymentStatus);
    }
  }

  for (const rows of rowSets) {
    for (const r of rows) {
      const primaryId = primaryOf.get(r.registrationId);
      if (primaryId) {
        r.billingRegistrationId = primaryId;
        const primaryTeam = teamNameById.get(primaryId);
        if (primaryTeam) r.billedWithTeamName = primaryTeam;
        if (statusByPrimary.has(primaryId)) r.paymentStatus = statusByPrimary.get(primaryId) ?? null;
        continue;
      }
      const members = membersOf.get(r.registrationId);
      if (members) {
        r.mergedTeamNames = members
          .map((id) => teamNameById.get(id))
          .filter((t): t is string => Boolean(t))
          .join(', ');
      }
    }
  }

  return primaryOf;
}

/**
 * GET handler — fetches registrations for the authenticated user.
 *
 * Returns personal registrations (linked to the user) and, for admins, all club
 * registrations with manual payment attribution when applicable. Manual payment
 * status is collapsed to 'completed' for personal queries and kept distinct for
 * admins.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;

  const { session } = result;
  const user = session.user as Record<string, unknown>;
  const userId = session.user.id;
  const role = (user.role as string) ?? "member";
  const userClubSlug = (user.clubSlug as string | null) ?? null;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) {
    return json({ error: "Missing X-Club-Slug header" }, { status: 400 });
  }

  const isAdmin = role === "admin";

  if (isAdmin && isMultiClubMode(context.env) && userClubSlug !== null && userClubSlug !== clubSlug) {
    return json({ error: "Access denied: club mismatch" }, { status: 403 });
  }

  const personalRows = await context.env.DB
    .prepare(
      `SELECT
         pr.id            AS registrationId,
         p.fanId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         up.relationship  AS relationship,
         NULL             AS linkedAccounts,
         sl.id            AS subscriptionLevelId,
         rsl.subscriptionLevelId AS overrideLevelId,
         sl.name          AS subscriptionLevelName,
         ${PERSONAL_PAYMENT_STATUS_SUBQUERY}
       FROM user_player up
       JOIN player p ON p.id = up.playerId
       JOIN player_registration pr ON pr.playerId = p.id
       ${subscriptionLevelJoinSql('pr')}
       WHERE up.userId = ? AND pr.clubSlug = ?
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(userId, clubSlug)
    .all<RegistrationRow>();

  if (!isAdmin) {
    await attachMergeGrouping(context.env.DB, clubSlug, [personalRows.results]);
    return json({
      personal: personalRows.results,
      club: null,
      scope: "user",
      lastImportedAt: null,
    });
  }

  const clubRows = await context.env.DB
    .prepare(
      `SELECT
         pr.id            AS registrationId,
         p.fanId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         NULL             AS relationship,
         GROUP_CONCAT(u.email || '|' || up.relationship, ',') AS linkedAccounts,
         sl.id            AS subscriptionLevelId,
         rsl.subscriptionLevelId AS overrideLevelId,
         sl.name          AS subscriptionLevelName,
         ${CLUB_PAYMENT_STATUS_SUBQUERY}
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       LEFT JOIN user_player up ON up.playerId = p.id
       LEFT JOIN "user" u ON u.id = up.userId
       ${subscriptionLevelJoinSql('pr')}
       WHERE pr.clubSlug = ?
       GROUP BY pr.id
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(clubSlug)
    .all<RegistrationRow>();

  // One read of the club's billing groups serves both passes.
  const primaryOf = await attachMergeGrouping(
    context.env.DB,
    clubSlug,
    [personalRows.results, clubRows.results],
  );

  const club = await attachManualAttribution(
    context.env.DB,
    clubSlug,
    clubRows.results,
    primaryOf,
  );

  // Lets the page say how old the numbers on screen are. Dry-run previews write
  // no log row, so this only ever moves on a committed import.
  const lastImport = await context.env.DB
    .prepare(`SELECT MAX(importedAt) AS importedAt FROM "club_import_log" WHERE clubSlug = ?`)
    .bind(clubSlug)
    .first<{ importedAt: number | null }>();

  return json({
    personal: personalRows.results,
    club,
    scope: "admin",
    lastImportedAt: lastImport?.importedAt ?? null,
  });
};

/**
 * DELETE handler — removes a player registration.
 *
 * Admin-only endpoint. Deletes the registration record from the database. Returns
 * 404 if the registration doesn't exist or doesn't belong to the club.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const registrationId = url.searchParams.get("registrationId");
  if (!registrationId) {
    return json({ error: "registrationId is required" }, { status: 400 });
  }

  // Deleting cascades away the only record that GoCardless is still collecting —
  // a pre-existing hazard this endpoint never guarded.
  const livePayment = await context.env.DB
    .prepare(
      `SELECT status FROM "player_payment"
        WHERE registrationId = ?
          AND clubSlug = ?
          AND status IN (${GC_BLOCKING_STATUSES.map(() => '?').join(',')})
          AND mandateId != ''
        LIMIT 1`
    )
    .bind(registrationId, clubSlug, ...GC_BLOCKING_STATUSES)
    .first<{ status: string }>();

  if (livePayment) {
    return json(
      {
        error: "This registration has a live GoCardless payment. Cancel the subscription "
          + "on the Payments tab before removing it.",
        status: livePayment.status,
      },
      { status: 409 },
    );
  }

  // primaryRegistrationId is ON DELETE RESTRICT, so this would otherwise surface
  // as a raw FK violation. Catch it and say what to do instead.
  const dependants = await context.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM "registration_merge"
        WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?`
    )
    .bind(registrationId, clubSlug)
    .first<{ n: number }>();

  if ((dependants?.n ?? 0) > 0) {
    return json(
      {
        error: `This registration is billed for ${dependants!.n} other `
          + `${dependants!.n === 1 ? "registration" : "registrations"}. `
          + "Unmerge the group before removing it.",
        mergedCount: dependants!.n,
      },
      { status: 409 },
    );
  }

  const result = await context.env.DB
    .prepare(`DELETE FROM "player_registration" WHERE id = ? AND clubSlug = ?`)
    .bind(registrationId, clubSlug)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: "registration not found" }, { status: 404 });
  }
  return json({ ok: true });
};
