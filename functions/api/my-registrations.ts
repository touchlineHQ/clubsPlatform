import { type Env, json, requireAuth, requireAdmin, getClubSlug, isMultiClubMode } from "../lib/api-helpers";
import { getPostHog, clubGroups } from "../lib/posthog";
import {
  billingIdFromJoinSql,
  billingMergeJoinSql,
  mergedTeamNamesSql,
  subscriptionLevelJoinSql,
} from "../lib/registration-merge";
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
  // Resolved in SQL, then stripped from rows that are not in a billing group by
  // omitMergeFieldsWhenUnmerged — a club that has merged nothing sends none of
  // these at all, which is the wire contract the page was built against.
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
  // Keyed on the row's BILLING registration, not its own id.
  //
  // This used to key on `pr.id` and let a JS pass overlay a secondary's status
  // with its primary's. That pass could only reach a primary it had already
  // loaded, which was every primary while this endpoint returned the whole club
  // — and stops being true the moment the read is paginated, because the primary
  // frequently is not on the page. The overlay would then silently leave a
  // secondary reading "Outstanding" and a player would be chased for money
  // already paid.
  //
  // The old comment here argued a subquery-per-row was too expensive to resolve
  // the group in SQL. That was right for an unbounded club scan and is wrong
  // now: `billingIdFromJoinSql` reads two real columns supplied by a PK-seeking
  // LEFT JOIN, so this is one index probe into player_payment(registrationId),
  // which idx_player_payment_reg_status makes index-only. Do not key this back
  // on pr.id.
  return `(
  SELECT CASE
    WHEN SUM(CASE WHEN pp.status = 'active' THEN 1 ELSE 0 END) > 0 THEN 'active'
    WHEN SUM(CASE WHEN pp.status = 'completed' THEN 1 ELSE 0 END) > 0 THEN 'completed'
    WHEN SUM(CASE WHEN pp.status = 'manual' THEN 1 ELSE 0 END) > 0 THEN ${manualBranch}
    WHEN SUM(CASE WHEN pp.status = 'mandate_only' THEN 1 ELSE 0 END) > 0 THEN 'pending'
    WHEN COUNT(pp.id) > 0 THEN 'inactive'
    ELSE NULL
  END
  FROM "player_payment" pp WHERE pp.registrationId = ${billingIdFromJoinSql('pr')}
) AS paymentStatus`;
}

/**
 * The club tab's "Linked accounts" cell, as a scalar subquery on pr.playerId.
 *
 * This was a `GROUP_CONCAT` over a `LEFT JOIN user_player`/`user` pair with a
 * `GROUP BY pr.id`. Two reasons it is not any more:
 *
 * - `GROUP_CONCAT` over a join has no defined argument order, so the same
 *   registration could list its guardians differently on consecutive requests.
 *   The nested `ORDER BY` fixes that. (`GROUP_CONCAT(x, sep ORDER BY y)` would
 *   be tidier but needs SQLite 3.44+, and D1's version is pinned nowhere here.)
 * - The `GROUP BY` forced a temp B-tree — rows arrive in `teamName` order, not
 *   `id` order — which costs the index-ordered walk that
 *   idx_player_registration_club_team exists to provide. That matters to the
 *   paginated endpoint this is groundwork for, where an ordered early exit is
 *   the difference between reading 50 rows and reading the club.
 *
 * The `','` separator is load-bearing: RegistrationsPage splits on it. An email
 * containing a comma would corrupt the split — pre-existing, not fixed here.
 */
const LINKED_ACCOUNTS_SQL = `(SELECT GROUP_CONCAT(la."v", ',') FROM (
      SELECT u2."email" || '|' || up2."relationship" AS "v"
        FROM "user_player" up2
        JOIN "user" u2 ON u2."id" = up2."userId"
       WHERE up2."playerId" = pr."playerId"
       ORDER BY u2."email"
    ) la)`;

const PERSONAL_PAYMENT_STATUS_SUBQUERY = paymentStatusSubquery(false);
const CLUB_PAYMENT_STATUS_SUBQUERY = paymentStatusSubquery(true);

interface ManualAttributionRow {
  /** The registration the manual row hangs off — a group's primary. */
  registrationId: string;
  manualPaidBy: string | null;
  manualPaidAt: number;
  manualNote: string | null;
}

/**
 * How many billing ids one audit lookup may name.
 *
 * D1 caps a query at 100 bound parameters. `clubSlug` takes one, so 80 leaves
 * generous headroom while keeping a full page to a single statement. This is
 * the same cap that forces MAX_MERGE_GROUP = 11 in
 * api/admin/registration-merges.ts — see the comment there.
 */
const MANUAL_ID_CHUNK = 80;

/**
 * Reads back who marked each manual payment as paid, from the audit log written
 * by api/admin/manual-payment.ts.
 *
 * Kept out of the main query — one extra lookup beats three correlated
 * subqueries, and it is skipped entirely when no row on the page is manual.
 *
 * Asks by **billing** id, because the manual row hangs off the group's primary:
 * a secondary would otherwise show "Paid in full" with nobody's name against it.
 * The row carries its own `billingRegistrationId` now that the merge is resolved
 * in SQL, so this no longer needs a secondary → primary map handed to it.
 *
 * Bounded by the id list rather than by club. The unbounded form — every
 * `manual_paid` row the club has ever written, filtered only on clubSlug,
 * targetTable and action — degraded with *admin activity* rather than data
 * volume, so it got worse for the most engaged clubs first.
 */
async function attachManualAttribution(
  db: D1Database,
  clubSlug: string,
  rows: RegistrationRow[],
): Promise<RegistrationRow[]> {
  const billingIdOf = (r: RegistrationRow) => r.billingRegistrationId ?? r.registrationId;

  const billingIds = [...new Set(
    rows.filter((r) => r.paymentStatus === "manual").map(billingIdOf),
  )];
  // Every club with no override on these rows stops here, having read nothing.
  if (billingIds.length === 0) return rows;

  const statements = [];
  for (let i = 0; i < billingIds.length; i += MANUAL_ID_CHUNK) {
    const ids = billingIds.slice(i, i + MANUAL_ID_CHUNK);
    statements.push(
      db
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
              AND pp.registrationId IN (${ids.map(() => "?").join(",")})
            ORDER BY al.createdAt DESC`
        )
        .bind(clubSlug, ...ids),
    );
  }

  const batches = await db.batch<ManualAttributionRow>(statements);

  // Ordered newest-first, so the first hit per registration is the override
  // currently in force — a registration re-marked after an undo has several.
  // Chunks cover disjoint id sets, so no id can be resolved from two of them.
  const latest = new Map<string, ManualAttributionRow>();
  for (const batch of batches) {
    for (const row of batch.results) {
      if (!latest.has(row.registrationId)) latest.set(row.registrationId, row);
    }
  }

  return rows.map((r) => {
    const attribution = r.paymentStatus === "manual"
      ? latest.get(billingIdOf(r))
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

/** The three merge columns every registration query selects, resolved in SQL. */
const MERGE_COLUMNS_SQL = `rm0."primaryRegistrationId" AS billingRegistrationId,
         bpr."teamName"              AS billedWithTeamName,
         ${mergedTeamNamesSql('pr')} AS mergedTeamNames`;

/**
 * Drops the three merge keys from rows that are not in a billing group.
 *
 * SQL hands back `NULL` for all three on an unmerged registration, but the page
 * was built against a wire contract where a club that has merged nothing sends
 * none of these keys at all — see the test that asserts exactly that. Three null
 * keys on every row of a whole-club response is also response weight for
 * nothing. Cheap: one pass, no database access.
 */
function omitMergeFieldsWhenUnmerged(rows: RegistrationRow[]): RegistrationRow[] {
  return rows.map((r) => {
    if (r.billingRegistrationId || r.mergedTeamNames) return r;
    const { billingRegistrationId: _b, billedWithTeamName: _t, mergedTeamNames: _m, ...rest } = r;
    return rest as RegistrationRow;
  });
}

/** Which read a failure came from. The client reports this back on #107. */
type ReadLabel = "personal_scan" | "club_scan" | "audit_read" | "import_stamp";

/** Carries the label of the read that failed up to the handler's catch. */
class ReadFailure extends Error {
  constructor(readonly read: ReadLabel, readonly cause: unknown) {
    super(`my-registrations ${read} failed`);
    this.name = "ReadFailure";
  }
}

interface ReadTiming {
  read: ReadLabel;
  ms: number;
}

/**
 * Runs one read, timing it and labelling any failure.
 *
 * #107 arrived as a bare client-side "Failed to load registrations" fired off a
 * `!res.ok` that read neither the status nor the body, so nobody could say
 * which of this endpoint's reads had died. This is the server half of fixing
 * that: a failure now names itself, both in the log and in the response.
 */
async function timedRead<T>(
  read: ReadLabel,
  timings: ReadTiming[],
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const value = await run();
    timings.push({ read, ms: Date.now() - started });
    return value;
  } catch (err) {
    timings.push({ read, ms: Date.now() - started });
    throw new ReadFailure(read, err);
  }
}

/** Wall-clock total past which a load is worth recording. */
const SLOW_READ_MS = 250;
/** Club size worth recording before it gets slow. */
const LARGE_CLUB_ROWS = 1000;

/**
 * Records how long the reads took and how much they returned — but only for a
 * load that was slow or a club that is big.
 *
 * Deliberately not on every request. This endpoint is the one suspected of
 * being killed by a resource limit, and the Workers Free plan allows 10ms of
 * CPU per request (see lib/auth.ts and api/admin/import-players.ts, both of
 * which are already shaped around it). Serialising a capture payload is CPU,
 * and the HTTP call is a subrequest, so making every healthy load pay for them
 * would push the very requests we are diagnosing closer to the edge. Sampling
 * the slow ones costs the healthy path nothing and is what we actually want to
 * read back.
 *
 * Sent through waitUntil so it is off the response path entirely. Counts and
 * durations only — no FAN numbers, no emails.
 *
 * A load that is *killed* reports nothing here, by definition. That case is
 * covered from the browser instead, by the status and body the page now reads.
 */
function reportReadCost(
  context: EventContext<Env, string, unknown>,
  userId: string,
  clubSlug: string,
  scope: "admin" | "user",
  timings: ReadTiming[],
  counts: { personal: number; club: number },
): void {
  const totalMs = timings.reduce((n, t) => n + t.ms, 0);
  if (totalMs < SLOW_READ_MS && counts.club < LARGE_CLUB_ROWS) return;

  const posthog = getPostHog(context.env);
  if (!posthog) return;

  context.waitUntil(
    posthog
      .captureImmediate({
        distinctId: userId,
        event: "registrations read",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          scope,
          total_ms: totalMs,
          personal_rows: counts.personal,
          club_rows: counts.club,
          ...Object.fromEntries(timings.map((t) => [`${t.read}_ms`, t.ms])),
        },
      })
      .catch((err) => console.error("PostHog capture failed", err)),
  );
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

  const timings: ReadTiming[] = [];

  try {
  const personalRows = await timedRead("personal_scan", timings, () => context.env.DB
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
         ${PERSONAL_PAYMENT_STATUS_SUBQUERY},
         ${MERGE_COLUMNS_SQL}
       FROM user_player up
       JOIN player p ON p.id = up.playerId
       JOIN player_registration pr ON pr.playerId = p.id
       ${billingMergeJoinSql('pr')}
       ${subscriptionLevelJoinSql('pr')}
       WHERE up.userId = ? AND pr.clubSlug = ?
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(userId, clubSlug)
    .all<RegistrationRow>());

  if (!isAdmin) {
    reportReadCost(context, userId, clubSlug, "user", timings, {
      personal: personalRows.results.length,
      club: 0,
    });
    return json({
      personal: omitMergeFieldsWhenUnmerged(personalRows.results),
      club: null,
      scope: "user",
      lastImportedAt: null,
    });
  }

  const clubRows = await timedRead("club_scan", timings, () => context.env.DB
    .prepare(
      `SELECT
         pr.id            AS registrationId,
         p.fanId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         NULL             AS relationship,
         ${LINKED_ACCOUNTS_SQL} AS linkedAccounts,
         sl.id            AS subscriptionLevelId,
         rsl.subscriptionLevelId AS overrideLevelId,
         sl.name          AS subscriptionLevelName,
         ${CLUB_PAYMENT_STATUS_SUBQUERY},
         ${MERGE_COLUMNS_SQL}
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       ${billingMergeJoinSql('pr')}
       ${subscriptionLevelJoinSql('pr')}
       WHERE pr.clubSlug = ?
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(clubSlug)
    .all<RegistrationRow>());

  // Both queries resolved their own billing groups in SQL, so there is no
  // whole-club registration_merge read here any more — and no JS pass that can
  // only reach a primary it happens to have loaded.
  const club = await timedRead("audit_read", timings, () => attachManualAttribution(
    context.env.DB,
    clubSlug,
    clubRows.results,
  ));

  // Lets the page say how old the numbers on screen are. Dry-run previews write
  // no log row, so this only ever moves on a committed import.
  const lastImport = await timedRead("import_stamp", timings, () => context.env.DB
    .prepare(`SELECT MAX(importedAt) AS importedAt FROM "club_import_log" WHERE clubSlug = ?`)
    .bind(clubSlug)
    .first<{ importedAt: number | null }>());

  reportReadCost(context, userId, clubSlug, "admin", timings, {
    personal: personalRows.results.length,
    club: club.length,
  });

  return json({
    personal: omitMergeFieldsWhenUnmerged(personalRows.results),
    club: omitMergeFieldsWhenUnmerged(club),
    scope: "admin",
    lastImportedAt: lastImport?.importedAt ?? null,
  });
  } catch (err) {
    if (!(err instanceof ReadFailure)) throw err;
    // Named, so #107 stops being "something in here broke". The log line is
    // free; the response body is what the browser reports back to PostHog.
    console.error("my-registrations read failed", {
      read: err.read,
      clubSlug,
      ms: timings.find((t) => t.read === err.read)?.ms ?? null,
      cause: String(err.cause),
    });
    return json(
      { error: "Failed to load registrations", read: err.read },
      { status: 500 },
    );
  }
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
