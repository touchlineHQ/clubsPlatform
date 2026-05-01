import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, getClubSlug } from "../lib/api-helpers";

const clubFilter = `(clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT id, src, caption
       FROM gallery_item
       WHERE ${clubFilter}
       ORDER BY sortOrder ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<{ id: string; src: string | null; caption: string }>();

  return json({ items: rows.results.map(r => ({ ...r, src: r.src ?? undefined })) });
};
