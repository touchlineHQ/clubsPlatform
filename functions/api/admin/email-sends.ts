import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requireAdmin,
  getClubSlug,
} from "../../lib/api-helpers";
import {
  listEmailSendEvents,
  type SendOutcome,
} from "../../lib/send-guard";

/**
 * Admin: surface recent email send / drop events.
 * Query: ?outcome=dropped|sent|skipped_unconfigured&limit=50
 */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const url = new URL(context.request.url);
  const outcomeRaw = url.searchParams.get("outcome");
  const outcome =
    outcomeRaw === "sent"
    || outcomeRaw === "dropped"
    || outcomeRaw === "skipped_unconfigured"
      ? (outcomeRaw as SendOutcome)
      : undefined;

  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  const events = await listEmailSendEvents(context.env.DB, clubSlug, { outcome, limit });
  return json({ events });
};
