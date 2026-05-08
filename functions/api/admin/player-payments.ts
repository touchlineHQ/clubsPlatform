import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, requireAdmin, getClubSlug } from '../../lib/api-helpers';

interface PlayerPaymentRow {
  id: string;
  registrationId: string;
  fanId: string;
  teamName: string;
  reference: string;
  mandateId: string;
  subscriptionId: string | null;
  amountInPence: number | null;
  intervalUnit: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT
         pp.id, pp.registrationId, p.fanId, pr.teamName,
         pp.reference, pp.mandateId, pp.subscriptionId,
         pp.amountInPence, pp.intervalUnit, pp.status,
         pp.createdAt, pp.updatedAt
       FROM "player_payment" pp
       JOIN "player_registration" pr ON pr.id = pp.registrationId
       JOIN "player" p ON p.id = pr.playerId
       WHERE pp.clubSlug = ?
       ORDER BY pp.createdAt DESC`
    )
    .bind(clubSlug)
    .all<PlayerPaymentRow>();

  return json({ payments: rows.results });
};
