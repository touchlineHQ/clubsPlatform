import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, getClubSlug, requireManagerOrAdmin } from '../../lib/api-helpers';
import { getSecret } from '../../lib/secrets';
import type { GCBillingRequest, GCBillingRequestFlow, CreateLinkBody } from './_types';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  await ensureTables(env.DB);

  const authResult = await requireManagerOrAdmin(context);
  if ('error' in authResult) return authResult.error;

  const clubSlug = getClubSlug(request);

  const gcToken = await getSecret(env.DB, env, clubSlug, 'GC_ACCESS_TOKEN');
  if (!gcToken) {
    return json({ error: 'GoCardless API token not configured. Set GC_ACCESS_TOKEN in Admin → API Secrets.' }, { status: 503 });
  }

  let body: CreateLinkBody;
  try {
    body = await request.json<CreateLinkBody>();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { team, fan, paymentType, amountInPence, intervalUnit, description } = body;

  if (!team || !fan || !paymentType || !amountInPence || amountInPence <= 0) {
    return json({ error: 'Missing or invalid required fields' }, { status: 400 });
  }

  const reference = `${team.replace(/\s+/g, '').toUpperCase()}-${fan}-${paymentType}`;

  const baseDescription = description || `${paymentType} payment - FAN ${fan}`;
  const pounds = (amountInPence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
  });
  const freq = intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month';
  const hostedDescription = `${baseDescription} — ${pounds} per ${freq}`;

  const gcBase =
    env.GC_ENVIRONMENT === 'live'
      ? 'https://api.gocardless.com'
      : 'https://api-sandbox.gocardless.com';

  const gcHeaders = {
    Authorization: `Bearer ${gcToken}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const brRes = await fetch(`${gcBase}/billing_requests`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      billing_requests: {
        mandate_request: {
          scheme: 'bacs',
          description: hostedDescription,
        },
        metadata: {
          reference,
          tracking_info: `team:${team}|fan:${fan}|type:${paymentType}`,
          billing_details: `${amountInPence}p-${intervalUnit || 'monthly'}`,
        },
      },
    }),
  });

  if (!brRes.ok) {
    const detail = await brRes.text();
    return json({ error: 'Failed to create billing request', detail }, { status: 502 });
  }

  const { billing_requests: br } = await brRes.json<{ billing_requests: GCBillingRequest }>();

  const origin = new URL(request.url).origin;
  const confirmParams = new URLSearchParams({
    billing_request_id: br.id,
    reference,
    amount: String(amountInPence),
    interval_unit: intervalUnit || 'monthly',
    description: baseDescription,
    fan,
    team,
    ...(clubSlug ? { club_slug: clubSlug } : {}),
  });
  const redirectUri = `${origin}/api/gocardless/confirm?${confirmParams.toString()}`;
  const exitUri = `${origin}/#/payment-cancelled`;

  const flowRes = await fetch(`${gcBase}/billing_request_flows`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      billing_request_flows: {
        redirect_uri: redirectUri,
        exit_uri: exitUri,
        links: {
          billing_request: br.id,
        },
      },
    }),
  });

  if (!flowRes.ok) {
    const detail = await flowRes.text();
    return json({ error: 'Failed to create billing request flow', detail }, { status: 502 });
  }

  const { billing_request_flows: flow } = await flowRes.json<{
    billing_request_flows: GCBillingRequestFlow;
  }>();

  return json(
    {
      authorisation_url: flow.authorisation_url,
      reference,
      billing_request_id: br.id,
    },
    { status: 200 }
  );
};
