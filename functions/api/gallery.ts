import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const body = await context.request.json() as { items: Array<{ src?: string; caption: string }> };
  const ts = nowMs();

  const stmts: D1PreparedStatement[] = [
    context.env.DB.prepare(`DELETE FROM gallery_item WHERE ${clubFilter}`).bind(clubSlug, clubSlug),
  ];
  for (let i = 0; i < (body.items ?? []).length; i++) {
    const item = body.items[i];
    stmts.push(
      context.env.DB.prepare(
        `INSERT INTO gallery_item (id, clubSlug, src, caption, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(`gallery_${crypto.randomUUID()}`, clubSlug, item.src ?? null, item.caption ?? '', i, ts, ts)
    );
  }
  await context.env.DB.batch(stmts);
  return json({ ok: true });
};
