import { ensureTables } from "../lib/ensure-tables";
import { clubPublicationUnavailable, isClubPublicationSchemaReady } from "../lib/club-publication";
import { type Env, json, nowMs, randomId, requireAdmin, isMultiClubMode, isPitchBookingsEnabled, getClubSlug } from "../lib/api-helpers";

type ClubRow = {
  id: string;
  slug: string;
  name: string;
  active: number;
  primaryColor: string | null;
  secondaryColor: string | null;
  published: number;
  createdAt: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const multiClub = isMultiClubMode(context.env);
  const pitchBookings = isPitchBookingsEnabled(context.env);

  // published is added by migration 0021, and a Pages deployment can land before
  // CI has applied it. Every club site resolves its slug through this endpoint,
  // so a missing column must not 500 the whole platform: fall back to the
  // pre-0021 column list and treat every club as live, which is what it was
  // before the column existed.
  const listClubs = (publishedColumn: string) => context.env.DB
    .prepare(`SELECT id, slug, name, active, primaryColor, secondaryColor, ${publishedColumn}, createdAt FROM club_config ORDER BY createdAt ASC`)
    .all<ClubRow>();

  let rows: D1Result<ClubRow>;
  try {
    rows = await listClubs('published');
  } catch {
    rows = await listClubs('1 AS published');
  }

  // Unpublished clubs stay in this list on purpose. The frontend resolves which
  // club a URL belongs to from the registry, so dropping them would leave the
  // club's own admins looking at the platform landing page with no way to log
  // in. GET /api/club is what actually withholds a private club's content.
  let clubs = rows.results
    .filter(r => r.active === 1)
    .map(r => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      primaryColor: r.primaryColor ?? null,
      secondaryColor: r.secondaryColor ?? null,
      published: r.published !== 0,
    }));

  // The demo club is a multi-club platform feature only — single-club forks
  // shouldn't accidentally surface it.
  if (!multiClub) {
    clubs = clubs.filter(c => c.slug !== 'demo');
  }

  return json({ multiClub, pitchBookings, clubs });
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

  if (!(await isClubPublicationSchemaReady(context.env.DB))) {
    return clubPublicationUnavailable();
  }

  const existing = await context.env.DB
    .prepare(`SELECT id FROM club_config WHERE slug = ?`)
    .bind(slug)
    .first<{ id: string }>();
  if (existing) return json({ error: "A club with that slug already exists" }, { status: 409 });

  // Same as self-signup: a club is created private and goes live deliberately.
  const id = randomId("club");
  await context.env.DB
    .prepare(`INSERT INTO club_config (id, slug, name, active, published, createdAt) VALUES (?, ?, ?, 1, 0, ?)`)
    .bind(id, slug, name, nowMs())
    .run();

  return json({ ok: true, id, slug }, { status: 201 });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }

  await ensureTables(context.env.DB);

  // Defensive: add primaryColor / secondaryColor columns if the production DB
  // predates migrations 0009 / 0015.
  //
  // `published` deliberately gets no equivalent. Self-healing a column that
  // migration 0021 also adds would make that migration fail with "duplicate
  // column name" — the hazard spelled out in lib/ensure-tables.ts. The GET
  // handlers fall back to treating every club as live instead, and the write
  // paths that need the column return a controlled unavailable response.
  try {
    await context.env.DB.prepare(`ALTER TABLE "club_config" ADD COLUMN "primaryColor" TEXT`).run();
  } catch { /* column already exists */ }
  try {
    await context.env.DB.prepare(`ALTER TABLE "club_config" ADD COLUMN "secondaryColor" TEXT`).run();
  } catch { /* column already exists */ }

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const existing = await context.env.DB
    .prepare(`SELECT id FROM club_config WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Not found" }, { status: 404 });

  // `published` is deliberately not settable here: this handler is gated on
  // multi-club mode above, and a single-club fork needs the go-live switch too.
  // It lives on PATCH /api/club instead.
  const body = (await context.request.json()) as Partial<{ name: string; active: boolean; primaryColor: string | null; secondaryColor: string | null; published: unknown }>;
  if ('published' in body) return json({ error: "Nothing to update" }, { status: 400 });

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, value: unknown) => { sets.push(`${col} = ?`); binds.push(value); };

  if (body.name !== undefined) set("name", body.name.trim());
  if (body.active !== undefined) set("active", body.active ? 1 : 0);
  if (body.primaryColor !== undefined) set("primaryColor", body.primaryColor ?? null);
  if (body.secondaryColor !== undefined) set("secondaryColor", body.secondaryColor ?? null);

  if (!sets.length) return json({ error: "Nothing to update" }, { status: 400 });

  await context.env.DB
    .prepare(`UPDATE club_config SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, existing.id)
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
