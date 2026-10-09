import { ensureTables } from "../../lib/ensure-tables";
import { readMeta, reportReadCost } from "../../lib/read-cost";
import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";

/**
 * The distinct teams and statuses in a club, for the filter Selects.
 *
 * A separate endpoint rather than folded into page 1 for two reasons. The
 * merged-groups view and the merge-rules pickers both want the same lists. And
 * these are deliberately **club-scoped, not filter-scoped**: the filter bar
 * derives its options from every row today precisely so that choosing a team
 * does not empty the team dropdown. Narrowing them with the active filters
 * would strand an admin on a selection they cannot undo.
 *
 * Both statements are index-only scans of idx_player_registration_club_team and
 * idx_player_registration_club_status.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const started = Date.now();
  const [teamsRes, statusesRes] = await context.env.DB.batch<{ value: string }>([
    context.env.DB.prepare(
      `SELECT DISTINCT pr."teamName" AS "value"
         FROM "player_registration" pr
        WHERE pr."clubSlug" = ? AND pr."teamName" <> ''
        ORDER BY pr."teamName" COLLATE NOCASE ASC`,
    ).bind(clubSlug),

    context.env.DB.prepare(
      `SELECT DISTINCT pr."registrationStatus" AS "value"
         FROM "player_registration" pr
        WHERE pr."clubSlug" = ?
          AND pr."registrationStatus" IS NOT NULL
          AND pr."registrationStatus" <> ''
        ORDER BY pr."registrationStatus" COLLATE NOCASE ASC`,
    ).bind(clubSlug),
  ]);

  // Club-scoped rather than filter-scoped, deliberately — so this one also
  // grows with the club, and both DISTINCTs are counted as the single read the
  // page actually waits on.
  reportReadCost(context, (auth.session.user as Record<string, unknown>).id as string, clubSlug, {
    endpoint: "registrations_facets",
    ms: Date.now() - started,
    rowsRead: (readMeta(teamsRes).rows_read ?? 0) + (readMeta(statusesRes).rows_read ?? 0) || undefined,
    rowsReturned: teamsRes.results.length + statusesRes.results.length,
  });

  return json({
    teams: teamsRes.results.map((r) => r.value),
    statuses: statusesRes.results.map((r) => r.value),
  });
};
