import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, nowMs, requireAdmin, getClubSlug } from '../../lib/api-helpers';
import { getPostHog } from '../../lib/posthog';

interface PlayerPaymentRow {
  id: string;
  registrationId: string;
  fanId: string;
  teamName: string;
  reference: string;
  mandateId: string;
  subscriptionId: string | null;
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
         pp.status, pp.createdAt, pp.updatedAt
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

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const body = await context.request.json<{ id?: string }>();

  if (!body.id) return json({ error: 'id required' }, { status: 400 });

  const { meta } = await context.env.DB
    .prepare(
      `UPDATE "player_payment" SET status = 'inactive', updatedAt = ?
        WHERE id = ? AND clubSlug = ?`
    )
    .bind(nowMs(), body.id, clubSlug)
    .run();

  if (!meta.changes) return json({ error: 'Payment not found' }, { status: 404 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment deactivated',
      properties: { club_slug: clubSlug, payment_id: body.id },
    });
  }

  return json({ ok: true });
};
