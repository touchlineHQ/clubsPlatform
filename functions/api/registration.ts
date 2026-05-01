import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, getClubSlug } from "../lib/api-helpers";

const clubFilter = `(clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT id, icon, title, description, link, buttonText
       FROM registration_item
       WHERE ${clubFilter}
       ORDER BY sortOrder ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<{ id: string; icon: string; title: string; description: string; link: string; buttonText: string }>();

  return json({ items: rows.results });
};
