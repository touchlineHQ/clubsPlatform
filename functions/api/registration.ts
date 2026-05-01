import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const body = await context.request.json() as { items: Array<{ icon: string; title: string; description: string; link: string; buttonText: string }> };
  const ts = nowMs();

  const stmts: D1PreparedStatement[] = [
    context.env.DB.prepare(`DELETE FROM registration_item WHERE ${clubFilter}`).bind(clubSlug, clubSlug),
  ];
  for (let i = 0; i < (body.items ?? []).length; i++) {
    const item = body.items[i];
    stmts.push(
      context.env.DB.prepare(
        `INSERT INTO registration_item (id, clubSlug, icon, title, description, link, buttonText, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `reg_${crypto.randomUUID()}`, clubSlug,
        item.icon ?? '', item.title ?? '', item.description ?? '',
        item.link ?? '#', item.buttonText ?? 'Find out more', i, ts, ts
      )
    );
  }
  await context.env.DB.batch(stmts);
  return json({ ok: true });
};
