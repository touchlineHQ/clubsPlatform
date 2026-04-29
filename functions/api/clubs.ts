import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, randomId, requireAdmin, isMultiClubMode } from "../lib/api-helpers";

type ClubRow = {
  id: string;
  slug: string;
  name: string;
  active: number;
  primaryColor: string | null;
  createdAt: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const multiClub = isMultiClubMode(context.env);

  const rows = await context.env.DB
    .prepare(`SELECT id, slug, name, active, primaryColor, createdAt FROM club_config ORDER BY createdAt ASC`)
    .all<ClubRow>();

  let clubs = rows.results
    .filter(r => r.active === 1)
    .map(r => ({ id: r.id, slug: r.slug, name: r.name, primaryColor: r.primaryColor ?? null }));

  // The demo club is a multi-club platform feature only — single-club forks
  // shouldn't accidentally surface it.
  if (!multiClub) {
    clubs = clubs.filter(c => c.slug !== 'demo');
  }

  return json({ multiClub, clubs });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const body = (await context.request.json()) as Partial<{ slug: string; name: string }>;
  const slug = body.slug?.trim().toLowerCase() ?? "";
  const name = body.name?.trim() ?? "";

  if (!slug || !name) return json({ error: "slug and name are required" }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return json({ error: "slug must contain only lowercase letters, numbers, and hyphens" }, { status: 400 });
  }

  const existing = await context.env.DB
    .prepare(`SELECT id FROM club_config WHERE slug = ?`)
    .bind(slug)
    .first<{ id: string }>();
  if (existing) return json({ error: "A club with that slug already exists" }, { status: 409 });

  const id = randomId("club");
  await context.env.DB
    .prepare(`INSERT INTO club_config (id, slug, name, active, createdAt) VALUES (?, ?, ?, 1, ?)`)
    .bind(id, slug, name, nowMs())
    .run();

  return json({ ok: true, id, slug }, { status: 201 });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const existing = await context.env.DB
    .prepare(`SELECT id FROM club_config WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Not found" }, { status: 404 });

  const body = (await context.request.json()) as Partial<{ name: string; active: boolean; primaryColor: string | null }>;

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, value: unknown) => { sets.push(`${col} = ?`); binds.push(value); };

  if (body.name !== undefined) set("name", body.name.trim());
  if (body.active !== undefined) set("active", body.active ? 1 : 0);
  if (body.primaryColor !== undefined) set("primaryColor", body.primaryColor ?? null);

  if (!sets.length) return json({ error: "Nothing to update" }, { status: 400 });

  await context.env.DB
    .prepare(`UPDATE club_config SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, id)
    .run();

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  await context.env.DB
    .prepare(`UPDATE club_config SET active = 0 WHERE id = ?`)
    .bind(id)
    .run();

  return json({ ok: true });
};
