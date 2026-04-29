import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, getClubSlug } from "../lib/api-helpers";

type PitchRow = {
  id: string;
  clubSlug: string | null;
  name: string;
  formats: string;
  description: string | null;
  active: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  const rows = await context.env.DB
    .prepare(
      `SELECT id, clubSlug, name, formats, description, active
       FROM pitch
       WHERE active = 1 AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))
       ORDER BY name ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<PitchRow>();

  const pitches = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    formats: JSON.parse(r.formats) as string[],
    description: r.description ?? undefined,
    active: r.active === 1,
  }));

  return json({ pitches });
};
