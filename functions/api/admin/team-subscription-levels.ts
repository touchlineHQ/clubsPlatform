import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../lib/api-helpers";

interface TeamLevelRow {
  teamName: string;
  playerCount: number;
  subscriptionLevelId: string | null;
  subscriptionLevelName: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: string | null;
}

interface AssignBody {
  teamName?: string;
  subscriptionLevelId?: string | null;
}

/**
 * Returns all teams that exist in this club's player_registration table,
 * left-joined with their assigned subscription level (if any).
 * This is what the treasurer assigns levels to.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT
         pr.teamName                         AS teamName,
         COUNT(DISTINCT pr.playerId)         AS playerCount,
         tsl.subscriptionLevelId             AS subscriptionLevelId,
         sl.name                             AS subscriptionLevelName,
         sl.yearlyPriceInPence               AS yearlyPriceInPence,
         sl.intervalCount                    AS intervalCount,
         sl.intervalUnit                     AS intervalUnit
       FROM player_registration pr
       LEFT JOIN team_subscription_level tsl
              ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
       LEFT JOIN subscription_level sl
              ON sl.id = tsl.subscriptionLevelId
       WHERE pr.clubSlug = ?
       GROUP BY pr.teamName, tsl.subscriptionLevelId, sl.name,
                sl.yearlyPriceInPence, sl.intervalCount, sl.intervalUnit
       ORDER BY pr.teamName COLLATE NOCASE ASC`
    )
    .bind(clubSlug)
    .all<TeamLevelRow>();

  return json({ teams: rows.results });
};

/**
 * Assigns or clears a team's subscription level.
 * Pass subscriptionLevelId = null to clear.
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

  const teamName = (body.teamName ?? "").trim();
  if (!teamName) return json({ error: "teamName is required" }, { status: 400 });

  const levelId = body.subscriptionLevelId ?? null;

  if (levelId === null) {
    await context.env.DB
      .prepare(`DELETE FROM "team_subscription_level" WHERE clubSlug = ? AND teamName = ?`)
      .bind(clubSlug, teamName)
      .run();
    return json({ ok: true, cleared: true });
  }

  const level = await context.env.DB
    .prepare(`SELECT id FROM "subscription_level" WHERE id = ? AND clubSlug = ?`)
    .bind(levelId, clubSlug)
    .first<{ id: string }>();
  if (!level) return json({ error: "subscription level not found for this club" }, { status: 404 });

  const now = nowMs();
  await context.env.DB
    .prepare(
      `INSERT INTO "team_subscription_level"
         (clubSlug, teamName, subscriptionLevelId, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(clubSlug, teamName) DO UPDATE SET
         subscriptionLevelId = excluded.subscriptionLevelId,
         updatedAt           = excluded.updatedAt`
    )
    .bind(clubSlug, teamName, levelId, now)
    .run();

  return json({ ok: true });
};
