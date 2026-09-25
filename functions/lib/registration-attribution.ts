import type { D1Database } from "@cloudflare/workers-types";

/**
 * Who marked a registration as manually paid, read back from the audit log
 * written by api/admin/manual-payment.ts.
 *
 * Kept out of the main query — one extra lookup beats three correlated
 * subqueries, and it is skipped entirely when no row in hand is manual.
 */

/** The shape attribution needs, so both endpoints' row types satisfy it. */
export interface AttributableRow {
  registrationId: string;
  paymentStatus: string | null;
  billingRegistrationId?: string | null;
  manualPaidBy?: string | null;
  manualPaidAt?: number | null;
  manualNote?: string | null;
}

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
export async function attachManualAttribution<T extends AttributableRow>(
  db: D1Database,
  clubSlug: string,
  rows: T[],
): Promise<T[]> {
  const billingIdOf = (r: AttributableRow) => r.billingRegistrationId ?? r.registrationId;

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
