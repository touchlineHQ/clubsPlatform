import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";

/**
 * Manual fixtures and results (#78).
 *
 * GET is public (the club site renders them); POST replaces the club's whole
 * list, admin only — the same replace-all shape as /api/matchday, so it fits
 * the Customise page's single "Save to Site".
 */

const clubFilter = `(clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`;

export const MAX_MANUAL_FIXTURES = 200;
const COLUMNS = 13;
// D1 caps bound parameters at 100 per statement.
const ROWS_PER_INSERT = Math.floor(100 / COLUMNS);

export interface ManualFixtureInput {
  team: string;
  date: string;
  time?: string;
  homeAway: "home" | "away";
  opponent: string;
  venue?: string;
  competition?: string;
  homeScore?: number | null;
  awayScore?: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length <= max ? t : null;
}

function score(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99) return v;
  return undefined;
}

/** Validate one entry; returns an error message, or the normalised entry. */
export function validateManualFixture(raw: unknown, index: number): { error: string } | { value: Required<ManualFixtureInput> } {
  const at = `items[${index}]`;
  if (!raw || typeof raw !== "object") return { error: `${at} must be an object` };
  const r = raw as Record<string, unknown>;
  const team = str(r.team, 100);
  if (!team) return { error: `${at}.team is required` };
  const opponent = str(r.opponent, 100);
  if (!opponent) return { error: `${at}.opponent is required` };
  const date = str(r.date, 10);
  if (!date || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { error: `${at}.date must be YYYY-MM-DD` };
  }
  const time = r.time === undefined || r.time === null ? "" : str(r.time, 5);
  if (time === null || (time !== "" && !TIME_RE.test(time))) return { error: `${at}.time must be HH:MM` };
  if (r.homeAway !== "home" && r.homeAway !== "away") return { error: `${at}.homeAway must be home or away` };
  const venue = r.venue === undefined || r.venue === null ? "" : str(r.venue, 200);
  if (venue === null) return { error: `${at}.venue is too long` };
  const competition = r.competition === undefined || r.competition === null ? "" : str(r.competition, 100);
  if (competition === null) return { error: `${at}.competition is too long` };
  const homeScore = score(r.homeScore);
  const awayScore = score(r.awayScore);
  if (homeScore === undefined || awayScore === undefined) return { error: `${at} scores must be whole numbers 0-99` };
  if ((homeScore === null) !== (awayScore === null)) return { error: `${at} needs both scores or neither` };
  return { value: { team, date, time, homeAway: r.homeAway, opponent, venue, competition, homeScore, awayScore } };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  const rows = await context.env.DB
    .prepare(
      `SELECT id, team, date, time, homeAway, opponent, venue, competition, homeScore, awayScore
       FROM manual_fixture
       WHERE ${clubFilter}
       ORDER BY date ASC, time ASC`
    )
    .bind(clubSlug, clubSlug)
    .all();
  return json({ items: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  let body: { items?: unknown };
  try {
    body = await context.request.json() as { items?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) return json({ error: "items must be an array" }, { status: 400 });
  if (body.items.length > MAX_MANUAL_FIXTURES) {
    return json({ error: `At most ${MAX_MANUAL_FIXTURES} manual fixtures` }, { status: 400 });
  }

  const items: Required<ManualFixtureInput>[] = [];
  for (let i = 0; i < body.items.length; i++) {
    const v = validateManualFixture(body.items[i], i);
    if ("error" in v) return json({ error: v.error }, { status: 400 });
    items.push(v.value);
  }

  const ts = nowMs();
  const stmts: D1PreparedStatement[] = [
    context.env.DB.prepare(`DELETE FROM manual_fixture WHERE ${clubFilter}`).bind(clubSlug, clubSlug),
  ];
  for (let start = 0; start < items.length; start += ROWS_PER_INSERT) {
    const chunk = items.slice(start, start + ROWS_PER_INSERT);
    const placeholders = chunk.map(() => `(${new Array(COLUMNS).fill("?").join(", ")})`).join(", ");
    const binds = chunk.flatMap((f) => [
      `fixture_${crypto.randomUUID()}`, clubSlug, f.team, f.date, f.time, f.homeAway, f.opponent,
      f.venue, f.competition, f.homeScore, f.awayScore, ts, ts,
    ]);
    stmts.push(
      context.env.DB.prepare(
        `INSERT INTO manual_fixture (id, clubSlug, team, date, time, homeAway, opponent, venue, competition, homeScore, awayScore, createdAt, updatedAt)
         VALUES ${placeholders}`
      ).bind(...binds)
    );
  }
  // One batch = one transaction: a failed insert rolls back the delete too.
  await context.env.DB.batch(stmts);
  return json({ ok: true, count: items.length });
};
