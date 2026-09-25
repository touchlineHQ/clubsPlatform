import { ensureTables } from "../../lib/ensure-tables";
import { readMeta, reportReadCost } from "../../lib/read-cost";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../lib/api-helpers";
import { prepareAuditLog } from "../../lib/audit-log";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  normaliseAgeGroup,
  suggestionCandidateSql,
  suggestionCtesSql,
  suggestionNotDismissedSql,
  zipSuggestionLists,
} from "../../lib/merge-suggestions";
import {
  buildCursorColumn,
  buildKeysetPredicate,
  buildOrderBy,
  fetchLimit,
  parsePageRequest,
  takePage,
  type SortWhitelist,
} from "../../lib/pagination";

/**
 * Merge suggestions for a club, and an admin's dismissals of them.
 *
 * The grouping used to run in the browser over every row the club had. #114
 * paged that array away and #121 withdrew the banner rather than let it
 * under-count, so this endpoint is the hint put back where it can see the whole
 * club. The rules are unchanged — see `lib/merge-suggestions.ts`.
 *
 * GET    ?state=open|dismissed&limit=&cursor=   list
 * POST   { playerId, ageGroup }                 dismiss a set
 * DELETE ?playerId=&ageGroup=                   undo a dismissal
 *
 * No statement here binds a list of ids, so D1's 100-bound-parameter cap is not
 * in play — `?suggestedOnly=1` and this endpoint both pass the candidate set as
 * a subquery for exactly that reason. It *would* be in play the moment anyone
 * passes one; cf. `MAX_MERGE_GROUP` in `registration-merges.ts` and
 * `MANUAL_ID_CHUNK` in `lib/registration-attribution.ts`.
 */

/**
 * One sort, and it is the grouping key.
 *
 * `fanId` carries the cursor's value and `ageKey` its tiebreak, which together
 * are the `(player, age group)` keyset over the grouped result. Both are in the
 * GROUP BY, so the cursor names a position the SQL can actually produce, and
 * `ageKey` is non-blank by the candidate scan's own WHERE, so it needs no
 * `totalTextKey` wrapper.
 */
const SUGGESTION_SORTS: SortWhitelist = {
  fanId: { expr: `g."fanId"`, collate: "NOCASE", bare: true },
};

/**
 * The same sort over the dismissals read, which joins `player` directly and so
 * spells the key against different aliases.
 *
 * A second whitelist rather than rewriting the generated SQL: the key name is
 * identical, so one `parsePageRequest` validates both, and the fragments are
 * built against whichever aliases the query actually has.
 */
const DISMISSED_SORTS: SortWhitelist = {
  fanId: { expr: `p."fanId"`, collate: "NOCASE", bare: true },
};

/**
 * This read groups the club by design, so it sits above the page-shaped
 * `ROWS_READ_SAMPLE` from its first request: 3,238 rows read in 14ms on the
 * busiest club we have. Sampling at the default would capture on every call,
 * which is CPU and a subrequest against the Free plan's 10ms budget for no
 * signal. 5,000 is above that measurement and the headroom
 * idx_player_registration_club_player_age buys, and still well below the
 * club-wide scan #114 removed — so it fires when this read starts behaving like
 * the thing that was deleted rather than like the grouped read it is.
 */
const SUGGESTION_ROWS_READ_SAMPLE = 5000;

interface GroupedRow {
  playerId: string;
  fanId: string;
  ageKey: string;
  ageGroup: string | null;
  setSize: number;
  ids: string | null;
  teamNames: string | null;
  __cursor?: string;
}

interface DismissedRow {
  playerId: string;
  fanId: string;
  ageKey: string;
  ageGroup: string | null;
  setSize: number;
  dismissedBy: string;
  dismissedAt: number;
  __cursor?: string;
}

/**
 * The candidate set for one player and age key, for a write's own accounting.
 *
 * Ordered in a nested select rather than with `GROUP_CONCAT(x, s ORDER BY y)`,
 * for the reason `mergedTeamNamesSql` gives: that form needs SQLite 3.44+ and
 * D1's version is pinned nowhere here. Without the order the audit note's team
 * list would follow the query plan, so adding an index could rewrite history.
 */
const SET_LOOKUP_SQL = `WITH candidate AS (
  ${suggestionCandidateSql()}
),
target AS (
  SELECT "ageGroup", "teamName"
    FROM candidate
   WHERE "playerId" = ? AND "ageKey" = ?
   ORDER BY "teamName" COLLATE NOCASE
)
SELECT COUNT(*) AS "setSize",
       MIN("ageGroup")                AS "ageGroup",
       GROUP_CONCAT("teamName", ', ') AS "teamNames"
  FROM target`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") ?? "open";
  if (state !== "open" && state !== "dismissed") {
    return json({ error: "unknown state" }, { status: 400 });
  }

  const parsed = parsePageRequest(
    {
      sort: url.searchParams.get("sort"),
      dir: url.searchParams.get("dir"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    },
    SUGGESTION_SORTS,
    { sort: "fanId", dir: "asc" },
  );
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const page = parsed.value;

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const started = Date.now();

  if (state === "dismissed") {
    const keyset = buildKeysetPredicate(page, DISMISSED_SORTS, `d."ageKey"`);
    const order = buildOrderBy(page, DISMISSED_SORTS, { idAlias: `d."ageKey"` });
    const cursorColumn = buildCursorColumn(page, DISMISSED_SORTS);

    // The display casing is recovered from a live registration, because the
    // table stores only the normalised key. A dismissal can outlive every
    // registration it covered, so fall back to the key rather than dropping
    // the row — an admin still needs to be able to undo it.
    const read = await context.env.DB
      .prepare(
        `SELECT d."playerId" AS "playerId",
                p."fanId"    AS "fanId",
                d."ageKey"   AS "ageKey",
                COALESCE((SELECT TRIM(pr2."ageGroup") FROM "player_registration" pr2
                           WHERE pr2."clubSlug" = d."clubSlug"
                             AND pr2."playerId" = d."playerId"
                             AND LOWER(TRIM(pr2."ageGroup")) = d."ageKey"
                           LIMIT 1), d."ageKey") AS "ageGroup",
                d."setSize"     AS "setSize",
                d."dismissedBy" AS "dismissedBy",
                d."dismissedAt" AS "dismissedAt",
                ${cursorColumn}
           FROM "registration_merge_suggestion_dismissal" d
           JOIN "player" p ON p."id" = d."playerId"
          WHERE d."clubSlug" = ?
            ${keyset.sql}
          ${order}
          LIMIT ?`,
      )
      .bind(clubSlug, ...keyset.bindings, fetchLimit(page))
      .all<DismissedRow>();

    const { items, nextCursor } = takePage(read.results, page, (row) => ({
      v: row.__cursor ?? "",
      id: row.ageKey,
    }));

    reportReadCost(context, adminId, clubSlug, {
      endpoint: "merge_suggestions",
      ms: Date.now() - started,
      rowsRead: readMeta(read).rows_read,
      rowsReturned: items.length,
      rowsReadSample: SUGGESTION_ROWS_READ_SAMPLE,
      extra: { state, limit: page.limit, paged: page.cursor !== null },
    });

    return json({
      suggestions: items.map(({ __cursor, ...row }) => row),
      nextCursor,
      limit: page.limit,
    });
  }

  const keyset = buildKeysetPredicate(page, SUGGESTION_SORTS, `g."ageKey"`);
  const order = buildOrderBy(page, SUGGESTION_SORTS, { idAlias: `g."ageKey"` });

  const sql = `${suggestionCtesSql()}
SELECT g."playerId", g."fanId", g."ageKey", g."ageGroup", g."setSize", g."ids", g."teamNames",
       ${buildCursorColumn(page, SUGGESTION_SORTS)}
  FROM grouped g
 WHERE ${suggestionNotDismissedSql()}
   ${keyset.sql}
 ${order}
 LIMIT ?`;

  // Batched with the count so the club-wide figure costs one round trip, not two.
  const statements = [
    context.env.DB.prepare(sql).bind(
      clubSlug,
      clubSlug,
      ...keyset.bindings,
      fetchLimit(page),
    ),
    context.env.DB
      .prepare(
        `SELECT COUNT(*) AS "n" FROM "registration_merge_suggestion_dismissal" WHERE "clubSlug" = ?`,
      )
      .bind(clubSlug),
  ];

  // The banner states a club-wide count, which the keyset page cannot give it
  // (pagination.ts returns no totals, deliberately). Charged on the first
  // request only — paging never re-pays for a number the banner already has.
  const wantsOpenCount = page.cursor === null;
  if (wantsOpenCount) {
    statements.push(
      context.env.DB
        .prepare(
          `${suggestionCtesSql()}
SELECT COUNT(*) AS "n" FROM grouped g WHERE ${suggestionNotDismissedSql()}`,
        )
        .bind(clubSlug, clubSlug),
    );
  }

  const [read, dismissedCountRead, openCountRead] = await context.env.DB.batch(statements);

  const rows = read.results as GroupedRow[];
  const { items, nextCursor } = takePage(rows, page, (row) => ({
    v: row.__cursor ?? "",
    id: row.ageKey,
  }));

  const dismissedCount = ((dismissedCountRead.results as { n: number }[])[0]?.n) ?? 0;
  const openCount = wantsOpenCount
    ? ((openCountRead?.results as { n: number }[] | undefined)?.[0]?.n ?? 0)
    : undefined;

  reportReadCost(context, adminId, clubSlug, {
    endpoint: "merge_suggestions",
    ms: Date.now() - started,
    rowsRead:
      (readMeta(read).rows_read ?? 0) + (readMeta(openCountRead ?? null).rows_read ?? 0) ||
      undefined,
    rowsReturned: items.length,
    rowsReadSample: SUGGESTION_ROWS_READ_SAMPLE,
    extra: {
      state,
      limit: page.limit,
      paged: page.cursor !== null,
      ...(openCount === undefined ? {} : { open_count: openCount }),
    },
  });

  return json({
    suggestions: items.map((row) => {
      const { registrationIds, teamNames } = zipSuggestionLists(row.ids, row.teamNames);
      return {
        playerId: row.playerId,
        fanId: row.fanId,
        ageGroup: row.ageGroup ?? row.ageKey,
        setSize: row.setSize,
        registrationIds,
        teamNames,
      };
    }),
    nextCursor,
    limit: page.limit,
    dismissedCount,
    ...(openCount === undefined ? {} : { openCount }),
  });
};

interface DismissBody {
  playerId?: string;
  ageGroup?: string;
  /** The size of the set the admin was looking at. See {@link onRequestPost}. */
  setSize?: number;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  let body: DismissBody;
  try {
    body = await context.request.json<DismissBody>();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const playerId = (body.playerId ?? "").trim();
  const ageKey = normaliseAgeGroup(body.ageGroup ?? "");
  const seenSize = body.setSize;
  if (!playerId) return json({ error: "playerId is required" }, { status: 400 });
  if (!ageKey) return json({ error: "ageGroup is required" }, { status: 400 });
  if (!Number.isInteger(seenSize) || (seenSize as number) < 2) {
    return json({ error: "setSize is required" }, { status: 400 });
  }

  const set = await context.env.DB
    .prepare(SET_LOOKUP_SQL)
    .bind(clubSlug, playerId, ageKey)
    .first<{ setSize: number; ageGroup: string | null; teamNames: string | null }>();

  if (!set || set.setSize < 2) {
    return json({ error: "no merge suggestion for this player and age group" }, { status: 400 });
  }

  // The dismissal must record the set the admin actually ruled on, so the size
  // they saw has to match the one that is here now. Storing the server's own
  // count instead would invert the whole point of `setSize`: an import that adds
  // a third registration between the banner loading and the click would have its
  // new set silently suppressed at size 3, which is exactly the "a genuinely new
  // third registration cannot hide behind an old no" that migration 0028 exists
  // to prevent. A 409 hands the admin the current figure and lets them look again.
  if (seenSize !== set.setSize) {
    return json(
      { error: "this suggestion has changed since it was loaded", setSize: set.setSize },
      { status: 409 },
    );
  }

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const now = nowMs();

  const write = context.env.DB
    .prepare(
      `INSERT INTO "registration_merge_suggestion_dismissal"
         ("clubSlug", "playerId", "ageKey", "setSize", "dismissedBy", "dismissedAt")
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT ("clubSlug", "playerId", "ageKey") DO UPDATE SET
         "setSize"     = excluded."setSize",
         "dismissedBy" = excluded."dismissedBy",
         "dismissedAt" = excluded."dismissedAt"`,
    )
    .bind(clubSlug, playerId, ageKey, set.setSize, adminId, now);

  const audit = prepareAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: "merge_suggestion_dismissed",
    targetTable: "player",
    targetId: playerId,
    newStatus: `${ageKey}:${set.setSize}`,
    note: `Kept separate in ${set.ageGroup ?? ageKey}: ${set.teamNames ?? ""}`,
  });

  await context.env.DB.batch([write, audit]);

  // Off the response path, like reportReadCost. The write is already committed
  // by here, so awaiting the capture would let a PostHog timeout answer a
  // successful dismissal with a 500 — and the banner would tell the admin their
  // decision did not land when it did.
  const posthog = getPostHog(context.env);
  if (posthog) {
    context.waitUntil(
      posthog
        .captureImmediate({
          distinctId: adminId,
          event: "merge suggestion dismissed",
          ...clubGroups(clubSlug),
          properties: { club_slug: clubSlug, set_size: set.setSize },
        })
        .catch((err) => console.error("PostHog capture failed", err)),
    );
  }

  return json({ ok: true, setSize: set.setSize });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const playerId = (url.searchParams.get("playerId") ?? "").trim();
  const ageKey = normaliseAgeGroup(url.searchParams.get("ageGroup") ?? "");
  if (!playerId) return json({ error: "playerId is required" }, { status: 400 });
  if (!ageKey) return json({ error: "ageGroup is required" }, { status: 400 });

  // Read before deleting: the audit entry wants the size that was dismissed,
  // and the SQLite test double does not report meta.changes, so a
  // delete-then-check could not tell a missing row from a deleted one.
  const existing = await context.env.DB
    .prepare(
      `SELECT "setSize" FROM "registration_merge_suggestion_dismissal"
        WHERE "clubSlug" = ? AND "playerId" = ? AND "ageKey" = ?`,
    )
    .bind(clubSlug, playerId, ageKey)
    .first<{ setSize: number }>();
  if (!existing) return json({ error: "dismissal not found" }, { status: 404 });

  const adminId = (auth.session.user as Record<string, unknown>).id as string;

  const write = context.env.DB
    .prepare(
      `DELETE FROM "registration_merge_suggestion_dismissal"
        WHERE "clubSlug" = ? AND "playerId" = ? AND "ageKey" = ?`,
    )
    .bind(clubSlug, playerId, ageKey);

  const audit = prepareAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: "merge_suggestion_restored",
    targetTable: "player",
    targetId: playerId,
    oldStatus: `${ageKey}:${existing.setSize}`,
    note: `Merge suggestion restored for ${ageKey}`,
  });

  await context.env.DB.batch([write, audit]);

  // Off the response path, like reportReadCost. The write is already committed
  // by here, so awaiting the capture would let a PostHog timeout answer a
  // successful dismissal with a 500 — and the banner would tell the admin their
  // decision did not land when it did.
  const posthog = getPostHog(context.env);
  if (posthog) {
    context.waitUntil(
      posthog
        .captureImmediate({
          distinctId: adminId,
          event: "merge suggestion dismissed",
          ...clubGroups(clubSlug),
          properties: { club_slug: clubSlug, set_size: existing.setSize, restored: true },
        })
        .catch((err) => console.error("PostHog capture failed", err)),
    );
  }

  return json({ ok: true });
};
