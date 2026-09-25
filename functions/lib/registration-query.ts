import { billingIdFromJoinSql, SUBSCRIPTION_LEVEL_ID_SQL } from "./registration-merge";
import { totalTextKey, type SortWhitelist } from "./pagination";

/**
 * The SQL the registrations list, summary and facets share.
 *
 * Every fragment is defined once here and interpolated wherever it is needed —
 * SELECT, WHERE, ORDER BY, the keyset predicate. That is the only defence
 * against the copies drifting: a sort expression that disagrees between ORDER
 * BY and the keyset predicate silently skips or repeats rows at every page
 * boundary, and nothing on screen says so.
 */

/**
 * A registration's payment status, collapsed the way the UI shows it and keyed
 * on the **billing** registration so a merged group reports one status.
 *
 * Requires `billingMergeJoinSql('pr')` in the FROM clause. `billingIdFromJoinSql`
 * is a COALESCE over two real columns that join supplies, so this stays one
 * index probe into player_payment(registrationId) however many times it is
 * repeated — which idx_player_payment_reg_status makes index-only.
 *
 * `distinguishManual` keeps an admin override visible to the club and folds it
 * into 'completed' for player-facing reads, matching api/my-registrations.ts.
 */
export function paymentStatusSql(
  distinguishManual: boolean,
  /**
   * Which registration's payments to collapse. Defaults to the billing
   * registration of `pr`; the summary passes a primary's own id instead, since
   * a primary is its own billing row by definition.
   */
  registrationIdExpr: string = billingIdFromJoinSql("pr"),
): string {
  const manualBranch = distinguishManual ? `'manual'` : `'completed'`;
  return `(
  SELECT CASE
    WHEN SUM(CASE WHEN pp."status" = 'active'       THEN 1 ELSE 0 END) > 0 THEN 'active'
    WHEN SUM(CASE WHEN pp."status" = 'completed'    THEN 1 ELSE 0 END) > 0 THEN 'completed'
    WHEN SUM(CASE WHEN pp."status" = 'manual'       THEN 1 ELSE 0 END) > 0 THEN ${manualBranch}
    WHEN SUM(CASE WHEN pp."status" = 'mandate_only' THEN 1 ELSE 0 END) > 0 THEN 'pending'
    WHEN COUNT(pp."id") > 0 THEN 'inactive'
    ELSE NULL
  END
  FROM "player_payment" pp WHERE pp."registrationId" = ${registrationIdExpr}
)`;
}

const CLUB_PAYMENT_STATUS_SQL = paymentStatusSql(true);

/**
 * The subscription badge's **label**, mirroring getSubscriptionStatus.
 *
 * The label rather than a semantic rank, because the client sorts on exactly
 * this string today and re-ranking would silently reorder a column people
 * already read. Alphabetically that is Cancelled, Mandate set up, Outstanding,
 * Paid in full, Paying — which is the order the page produces now.
 *
 * `CASE <expr> WHEN …` evaluates the status once, and NULL matches no WHEN, so
 * a registration with no payment rows falls to ELSE exactly as the client's
 * `default` arm does.
 */
export const SUBSCRIPTION_LABEL_SQL = `CASE ${CLUB_PAYMENT_STATUS_SQL}
    WHEN 'completed' THEN 'Paid in full'
    WHEN 'manual'    THEN 'Paid in full'
    WHEN 'active'    THEN 'Paying'
    WHEN 'pending'   THEN 'Mandate set up'
    WHEN 'inactive'  THEN 'Cancelled'
    ELSE 'Outstanding'
  END`;

/** SubStatus token → badge label. The filter binds a label, so this is the only CASE. */
const SUBSCRIPTION_TOKEN_TO_LABEL: Readonly<Record<string, string>> = {
  paid: "Paid in full",
  paying: "Paying",
  setup: "Mandate set up",
  outstanding: "Outstanding",
  cancelled: "Cancelled",
};

export const SUBSCRIPTION_TOKENS = Object.keys(SUBSCRIPTION_TOKEN_TO_LABEL);

/**
 * The sortable columns, and only these. Anything else is a 400.
 *
 * `teamName` and `fanId` are `NOT NULL` in the schema, so they stay bare and an
 * index can satisfy the ordering. The other three are nullable and go through
 * `totalTextKey` — without it the keyset predicate compares against NULL and
 * returns an *empty* page rather than a mis-ordered one.
 */
export const REGISTRATION_SORTS: SortWhitelist = {
  teamName: { expr: `pr."teamName"`, collate: "NOCASE", bare: true },
  fanId: { expr: `p."fanId"`, collate: "NOCASE", bare: true },
  registrationExpiry: { expr: totalTextKey(`pr."registrationExpiry"`), collate: "NOCASE" },
  registrationStatus: { expr: totalTextKey(`pr."registrationStatus"`), collate: "NOCASE" },
  subscriptionLevel: { expr: totalTextKey(`sl."name"`), collate: "NOCASE" },
  subscription: { expr: SUBSCRIPTION_LABEL_SQL, collate: "NOCASE" },
};

export interface RegistrationFilters {
  team?: string | null;
  status?: string | null;
  subscription?: string | null;
  q?: string | null;
}

/** Escapes the LIKE wildcards, or a `q` of '%' matches the whole club. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Drops a leading `FAN` that belongs to the label rather than the value.
 *
 * Both admin search boxes put the words FAN ID next to the number — the picker
 * labels its options `FAN 12345 — Under 10s`, the club table's column header is
 * `FAN ID` — while `player.fanId` holds `12345`. So an admin typing what is on
 * screen matches nothing under a prefix search.
 *
 * Used to add a second LIKE arm, never to rewrite the query: a `fanId` that
 * genuinely starts with `FAN` (this repo's own fixtures do, and the column is
 * whatever the FA export's FAN ID cell contained) and a team named "Fan Zone"
 * both still match through the untouched original pattern. That is what lets
 * the separator be optional here without risking a false strip.
 */
export function stripFanPrefix(value: string): string {
  return value.replace(/^fan[\s:#-]*/i, "");
}

/**
 * The `q` predicate and its bindings: a prefix over `fanId` and `teamName`,
 * plus a `fanId` arm for the same query with a `FAN` label prefix removed.
 *
 * The extra arm is added only when stripping changed something and left
 * something — `q` of exactly "FAN" would otherwise bind `%` and match the whole
 * club, which is the read these endpoints exist to remove.
 */
export function buildSearchPredicate(q: string): { sql: string; bindings: string[] } {
  const pattern = `${escapeLike(q)}%`;
  const arms = [`p."fanId" LIKE ? ESCAPE '\\'`, `pr."teamName" LIKE ? ESCAPE '\\'`];
  const bindings = [pattern, pattern];

  const stripped = stripFanPrefix(q);
  if (stripped && stripped !== q) {
    arms.push(`p."fanId" LIKE ? ESCAPE '\\'`);
    bindings.push(`${escapeLike(stripped)}%`);
  }

  return { sql: `(${arms.join(" OR ")})`, bindings };
}

/**
 * The filter predicates and their bindings, shared by the list and the summary
 * so the two can never disagree about what a filter means.
 *
 * Everything here belongs in WHERE rather than HAVING: each term references
 * only columns functionally determined by `pr.id`, so filtering before
 * grouping is equivalent and strictly cheaper — a WHERE term can drive an
 * index, a HAVING term never can.
 *
 * `q` matches `fanId` and `teamName` only, never `linkedAccounts`. That is a
 * GROUP_CONCAT, so a predicate on it could only live in HAVING, which would
 * destroy every index-driven plan and break the keyset scheme outright. It goes
 * through {@link buildSearchPredicate}, so the club list and the summary agree
 * about the FAN-label arm as well as about everything else.
 */
export function buildRegistrationFilters(
  clubSlug: string,
  filters: RegistrationFilters,
): { sql: string; bindings: unknown[]; error?: string } {
  const parts: string[] = [`pr."clubSlug" = ?`];
  const bindings: unknown[] = [clubSlug];

  if (filters.team) {
    parts.push(`pr."teamName" = ?`);
    bindings.push(filters.team);
  }

  if (filters.status) {
    // COALESCE, not a bare `=`: the client compares (status ?? '') so a bare
    // equality would drop NULL-status rows with nothing to explain why.
    parts.push(`COALESCE(pr."registrationStatus", '') = ?`);
    bindings.push(filters.status);
  }

  if (filters.subscription) {
    const label = SUBSCRIPTION_TOKEN_TO_LABEL[filters.subscription];
    if (!label) return { sql: "", bindings: [], error: "unknown subscription filter" };
    parts.push(`(${SUBSCRIPTION_LABEL_SQL}) = ?`);
    bindings.push(label);
  }

  if (filters.q) {
    const search = buildSearchPredicate(filters.q);
    parts.push(search.sql);
    bindings.push(...search.bindings);
  }

  return { sql: parts.join("\n  AND "), bindings };
}

/** Reads the filters off a request, trimming blanks to null. */
export function readFilters(url: URL): RegistrationFilters {
  const value = (key: string) => {
    const raw = url.searchParams.get(key);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  };
  return {
    team: value("team"),
    status: value("status"),
    subscription: value("subscription"),
    q: value("q"),
  };
}

/** Whether a subscription unit counts as paying, mirroring summariseRegistrations. */
export const PAYING_STATUSES_SQL = `('active', 'completed', 'manual')`;

/** Whether a registration has a subscription level, mirroring its `hasLevel`. */
export const HAS_LEVEL_SQL = `(${SUBSCRIPTION_LEVEL_ID_SQL} IS NOT NULL)`;
