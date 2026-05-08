import { ensureTables } from "../../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../../lib/api-helpers";

type IntervalUnit = "weekly" | "monthly" | "yearly";
const INTERVAL_UNITS: ReadonlyArray<IntervalUnit> = ["weekly", "monthly", "yearly"];

interface UpdateLevelBody {
  name?: string;
  yearlyPriceInPence?: number;
  intervalCount?: number;
  intervalUnit?: string;
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "club slug header missing" }, { status: 400 });

  const id = context.params.id as string;
  if (!id) return json({ error: "id is required" }, { status: 400 });

  let body: UpdateLevelBody;
  try {
    body = await context.request.json<UpdateLevelBody>();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const fields: string[] = [];
  const binds: unknown[] = [];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 80) {
      return json({ error: "name must be 1-80 characters" }, { status: 400 });
    }
    fields.push(`name = ?`);
    binds.push(name);
  }
  if (body.yearlyPriceInPence !== undefined) {
    const n = Number(body.yearlyPriceInPence);
    if (!Number.isInteger(n) || n <= 0) {
      return json({ error: "yearlyPriceInPence must be a positive integer (pence)" }, { status: 400 });
    }
    fields.push(`yearlyPriceInPence = ?`);
    binds.push(n);
  }
  if (body.intervalCount !== undefined) {
    const n = Number(body.intervalCount);
    if (!Number.isInteger(n) || n < 1 || n > 52) {
      return json({ error: "intervalCount must be an integer between 1 and 52" }, { status: 400 });
    }
    fields.push(`intervalCount = ?`);
    binds.push(n);
  }
  if (body.intervalUnit !== undefined) {
    const u = body.intervalUnit as IntervalUnit;
    if (!INTERVAL_UNITS.includes(u)) {
      return json({ error: `intervalUnit must be one of ${INTERVAL_UNITS.join(", ")}` }, { status: 400 });
    }
    fields.push(`intervalUnit = ?`);
    binds.push(u);
  }

  if (fields.length === 0) {
    return json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  fields.push(`updatedAt = ?`);
  binds.push(nowMs());
  binds.push(id, clubSlug);

  try {
    const result = await context.env.DB
      .prepare(`UPDATE "subscription_level" SET ${fields.join(", ")} WHERE id = ? AND clubSlug = ?`)
      .bind(...binds)
      .run();

    if (result.meta.changes === 0) {
      return json({ error: "subscription level not found" }, { status: 404 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return json({ error: "A subscription level with that name already exists" }, { status: 409 });
    }
    throw e;
  }

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "club slug header missing" }, { status: 400 });

  const id = context.params.id as string;
  if (!id) return json({ error: "id is required" }, { status: 400 });

  const result = await context.env.DB
    .prepare(`DELETE FROM "subscription_level" WHERE id = ? AND clubSlug = ?`)
    .bind(id, clubSlug)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: "subscription level not found" }, { status: 404 });
  }
  return json({ ok: true });
};
