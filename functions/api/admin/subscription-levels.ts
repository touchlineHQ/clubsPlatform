import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { getPostHog } from "../../lib/posthog";

type IntervalUnit = "weekly" | "monthly" | "yearly";
const INTERVAL_UNITS: ReadonlyArray<IntervalUnit> = ["weekly", "monthly", "yearly"];

export interface SubscriptionLevelRow {
  id: string;
  clubSlug: string;
  name: string;
  yearlyPriceInPence: number;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  startDate: string | null;
  createdAt: number;
  updatedAt: number;
}

interface CreateLevelBody {
  name?: string;
  yearlyPriceInPence?: number;
  intervalCount?: number;
  intervalUnit?: string;
  startDate?: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateStartDate(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    return { ok: false, error: "startDate must be a YYYY-MM-DD date" };
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "startDate must be a valid date" };
  return { ok: true, value };
}

function validate(body: CreateLevelBody): { ok: true; data: { name: string; yearlyPriceInPence: number; intervalCount: number; intervalUnit: IntervalUnit; startDate: string | null } } | { ok: false; error: string } {
  const name = (body.name ?? "").trim();
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > 80) return { ok: false, error: "name must be 80 characters or fewer" };

  const yearly = Number(body.yearlyPriceInPence);
  if (!Number.isFinite(yearly) || !Number.isInteger(yearly) || yearly <= 0) {
    return { ok: false, error: "yearlyPriceInPence must be a positive integer (pence)" };
  }

  const intervalCount = Number(body.intervalCount ?? 1);
  if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 52) {
    return { ok: false, error: "intervalCount must be an integer between 1 and 52" };
  }

  const intervalUnit = (body.intervalUnit ?? "yearly") as IntervalUnit;
  if (!INTERVAL_UNITS.includes(intervalUnit)) {
    return { ok: false, error: `intervalUnit must be one of ${INTERVAL_UNITS.join(", ")}` };
  }

  const start = validateStartDate(body.startDate);
  if (!start.ok) return { ok: false, error: start.error };

  return { ok: true, data: { name, yearlyPriceInPence: yearly, intervalCount, intervalUnit, startDate: start.value } };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT id, clubSlug, name, yearlyPriceInPence, intervalCount, intervalUnit,
              startDate, createdAt, updatedAt
         FROM "subscription_level"
        WHERE clubSlug = ?
        ORDER BY name COLLATE NOCASE ASC`
    )
    .bind(clubSlug)
    .all<SubscriptionLevelRow>();

  return json({ levels: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "club slug header missing" }, { status: 400 });

  let body: CreateLevelBody;
  try {
    body = await context.request.json<CreateLevelBody>();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const validated = validate(body);
  if (!validated.ok) return json({ error: validated.error }, { status: 400 });
  const { name, yearlyPriceInPence, intervalCount, intervalUnit, startDate } = validated.data;

  const id = randomId("sublvl");
  const now = nowMs();

  try {
    await context.env.DB
      .prepare(
        `INSERT INTO "subscription_level"
           (id, clubSlug, name, yearlyPriceInPence, intervalCount, intervalUnit,
            startDate, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, clubSlug, name, yearlyPriceInPence, intervalCount, intervalUnit, startDate, now, now)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return json({ error: `A subscription level named "${name}" already exists` }, { status: 409 });
    }
    throw e;
  }

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'subscription level created',
      properties: { club_slug: clubSlug, level_id: id, level_name: name, yearly_price_in_pence: yearlyPriceInPence, interval_count: intervalCount, interval_unit: intervalUnit },
    });
  }

  return json({
    level: {
      id, clubSlug, name, yearlyPriceInPence, intervalCount, intervalUnit, startDate,
      createdAt: now, updatedAt: now,
    } satisfies SubscriptionLevelRow,
  }, { status: 201 });
};
