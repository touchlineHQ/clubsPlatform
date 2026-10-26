import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, nowMs, requirePermission, getClubSlug } from "../../lib/api-helpers";
import { MAX_ARREARS_ROWS, arrearsQuery, arrearsReason } from "../../lib/arrears";

/**
 * GET /api/admin/arrears?team=&minDays= (#77)
 *
 * Everyone outstanding at the club, optionally for one team and registered at
 * least `minDays` ago. Each row says why it is in arrears (a failed Direct
 * Debit is distinct from never having set one up), how many of the player's
 * contacts a reminder can reach and why the others are excluded, and when the
 * registration was last chased.
 */

type Row = {
  registrationId: string;
  fanId: string;
  teamName: string;
  registeredAt: number;
  subscriptionLevelName: string | null;
  subscriptionLabel: string;
  failedAt: number | null;
  failureCause: string | null;
  reachableContacts: number;
  objectedContacts: number;
  pendingContacts: number;
  unreachableContacts: number;
  lastChasedAt: number | null;
  chaseCount: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "payments");
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const url = new URL(context.request.url);
  const teamName = url.searchParams.get("team")?.trim() || null;
  const minDaysRaw = url.searchParams.get("minDays");
  let minDays: number | null = null;
  if (minDaysRaw !== null && minDaysRaw !== "") {
    const n = Number(minDaysRaw);
    if (!Number.isInteger(n) || n < 0 || n > 3650) {
      return json({ error: "minDays must be a whole number of days" }, { status: 400 });
    }
    minDays = n;
  }

  const q = arrearsQuery(clubSlug, { teamName, minDays, now: nowMs() });
  const res = await context.env.DB.prepare(q.sql).bind(...q.bindings).all<Row>();
  const rows = res.results ?? [];
  const truncated = rows.length > MAX_ARREARS_ROWS;

  return json({
    rows: rows.slice(0, MAX_ARREARS_ROWS).map((r) => ({ ...r, reason: arrearsReason(r) })),
    truncated,
  });
};
