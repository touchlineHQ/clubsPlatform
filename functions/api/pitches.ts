import { ensureTables } from "../lib/ensure-tables";
import { CLUB_PITCH, requireClubFeature } from "../lib/club-features";
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
  const featureOff = await requireClubFeature(context.env, getClubSlug(context.request), "pitchBookings");
  if (featureOff) return featureOff;
  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  const rows = await context.env.DB
    .prepare(
      `SELECT id, clubSlug, name, formats, description, active
       FROM pitch
       WHERE active = 1 AND ${CLUB_PITCH}
       ORDER BY name ASC`
    )
    .bind(clubSlug)
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
