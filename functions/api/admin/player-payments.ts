import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, requireAdmin, getClubSlug } from '../../lib/api-helpers';

interface PlayerPaymentRow {
  id: string;
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
      `SELECT id, fanId, teamName, reference, mandateId, subscriptionId,
              amountInPence, intervalUnit, status, createdAt, updatedAt
       FROM "player_payment"
       WHERE clubSlug = ?
       ORDER BY createdAt DESC`
    )
    .bind(clubSlug)
    .all<PlayerPaymentRow>();

  return json({ payments: rows.results });
};
