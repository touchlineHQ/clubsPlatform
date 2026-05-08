import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, getClubSlug, requireManagerOrAdmin } from '../../lib/api-helpers';
import { createGoCardlessLink } from '../../lib/gocardless-link';
import type { CreateLinkBody } from './_types';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  await ensureTables(env.DB);

  const authResult = await requireManagerOrAdmin(context);
  if ('error' in authResult) return authResult.error;

  const clubSlug = getClubSlug(request);

  let body: CreateLinkBody;
  try {
    body = await request.json<CreateLinkBody>();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await createGoCardlessLink({
    env,
    db: env.DB,
    clubSlug,
    registrationId: body.registrationId,
    paymentType: body.paymentType,
    amountInPence: body.amountInPence,
    intervalUnit: body.intervalUnit ?? 'monthly',
    count: body.count,
    description: body.description,
    origin: new URL(request.url).origin,
  });

  if (!result.ok) {
    return json({ error: result.error, ...(result.detail ? { detail: result.detail } : {}) }, { status: result.status });
  }

  return json(
    {
      authorisation_url: result.authorisationUrl,
      reference: result.reference,
      billing_request_id: result.billingRequestId,
    },
    { status: 200 }
  );
};
