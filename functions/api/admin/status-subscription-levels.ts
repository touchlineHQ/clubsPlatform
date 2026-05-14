import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../lib/api-helpers";

interface ClubRateRow {
  registrationStatus: string;
  subscriptionLevelId: string;
  subscriptionLevelName: string;
  yearlyPriceInPence: number;
  intervalCount: number;
  intervalUnit: string;
}

interface TeamRateRow extends ClubRateRow {
  teamName: string;
}

interface AssignBody {
  registrationStatus?: string;
  subscriptionLevelId?: string | null;
  teamName?: string;
}

/**
 * Returns all status-based subscription rate rules for this club:
 * - statuses: distinct registrationStatus values across all player_registrations
 * - clubRates: club-wide status → level mappings (status_subscription_level)
 * - teamRates: per-team status → level overrides (team_status_subscription_level)
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);

  const [statusesRes, clubRatesRes, teamRatesRes] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT DISTINCT registrationStatus
         FROM "player_registration"
        WHERE clubSlug = ? AND registrationStatus IS NOT NULL
        ORDER BY registrationStatus COLLATE NOCASE ASC`
    ).bind(clubSlug),

    context.env.DB.prepare(
      `SELECT ssl.registrationStatus,
              ssl.subscriptionLevelId,
              sl.name          AS subscriptionLevelName,
              sl.yearlyPriceInPence,
              sl.intervalCount,
              sl.intervalUnit
         FROM "status_subscription_level" ssl
         JOIN "subscription_level" sl ON sl.id = ssl.subscriptionLevelId
        WHERE ssl.clubSlug = ?
        ORDER BY ssl.registrationStatus COLLATE NOCASE ASC`
    ).bind(clubSlug),

    context.env.DB.prepare(
      `SELECT tssl.teamName,
              tssl.registrationStatus,
              tssl.subscriptionLevelId,
              sl.name          AS subscriptionLevelName,
              sl.yearlyPriceInPence,
              sl.intervalCount,
              sl.intervalUnit
         FROM "team_status_subscription_level" tssl
         JOIN "subscription_level" sl ON sl.id = tssl.subscriptionLevelId
        WHERE tssl.clubSlug = ?
        ORDER BY tssl.teamName COLLATE NOCASE ASC, tssl.registrationStatus COLLATE NOCASE ASC`
    ).bind(clubSlug),
  ]);

  const statuses = (statusesRes.results as { registrationStatus: string }[]).map(r => r.registrationStatus);

  return json({
    statuses,
    clubRates: clubRatesRes.results as ClubRateRow[],
    teamRates: teamRatesRes.results as TeamRateRow[],
  });
};

/**
 * Upsert or clear a status-based subscription rate.
 *
 * Body:
 *   { registrationStatus, subscriptionLevelId }           → club-wide rate
 *   { teamName, registrationStatus, subscriptionLevelId } → team override
 *
 * Pass subscriptionLevelId = null to clear the rule.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "club slug header missing" }, { status: 400 });

  let body: AssignBody;
  try {
    body = await context.request.json<AssignBody>();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const registrationStatus = (body.registrationStatus ?? "").trim();
  if (!registrationStatus) return json({ error: "registrationStatus is required" }, { status: 400 });

  const teamName = (body.teamName ?? "").trim() || null;
  const levelId = body.subscriptionLevelId ?? null;

  if (teamName) {
    // Team-specific override
    if (levelId === null) {
      await context.env.DB
        .prepare(
          `DELETE FROM "team_status_subscription_level"
            WHERE clubSlug = ? AND teamName = ? AND registrationStatus = ?`
        )
        .bind(clubSlug, teamName, registrationStatus)
        .run();
      return json({ ok: true, cleared: true });
    }

    const level = await context.env.DB
      .prepare(`SELECT id FROM "subscription_level" WHERE id = ? AND clubSlug = ?`)
      .bind(levelId, clubSlug)
      .first<{ id: string }>();
    if (!level) return json({ error: "subscription level not found for this club" }, { status: 404 });

    await context.env.DB
      .prepare(
        `INSERT INTO "team_status_subscription_level"
           (clubSlug, teamName, registrationStatus, subscriptionLevelId, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(clubSlug, teamName, registrationStatus) DO UPDATE SET
           subscriptionLevelId = excluded.subscriptionLevelId,
           updatedAt           = excluded.updatedAt`
      )
      .bind(clubSlug, teamName, registrationStatus, levelId, nowMs())
      .run();
  } else {
    // Club-wide rate
    if (levelId === null) {
      await context.env.DB
        .prepare(
          `DELETE FROM "status_subscription_level"
            WHERE clubSlug = ? AND registrationStatus = ?`
        )
        .bind(clubSlug, registrationStatus)
        .run();
      return json({ ok: true, cleared: true });
    }

    const level = await context.env.DB
      .prepare(`SELECT id FROM "subscription_level" WHERE id = ? AND clubSlug = ?`)
      .bind(levelId, clubSlug)
      .first<{ id: string }>();
    if (!level) return json({ error: "subscription level not found for this club" }, { status: 404 });

    await context.env.DB
      .prepare(
        `INSERT INTO "status_subscription_level"
           (clubSlug, registrationStatus, subscriptionLevelId, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(clubSlug, registrationStatus) DO UPDATE SET
           subscriptionLevelId = excluded.subscriptionLevelId,
           updatedAt           = excluded.updatedAt`
      )
      .bind(clubSlug, registrationStatus, levelId, nowMs())
      .run();
  }

  return json({ ok: true });
};
