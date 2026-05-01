import { ensureTables } from "../lib/ensure-tables";
import { seedClubData } from "../lib/seed";
import { type Env, json, getClubSlug, requireAdmin } from "../lib/api-helpers";

type ClubRow = {
  slug: string;
  name: string;
  primaryColor: string | null;
  data: string | null;
  seeded: number;
};

function defaultClub(slug: string, name: string) {
  return {
    slug,
    name,
    tagline: '',
    founded: new Date().getFullYear(),
    email: '',
    address: { line1: '', line2: '', postcode: '' },
    what3words: '',
    socials: { facebook: '', instagram: '', twitter: '' },
    about: [],
    history: [],
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const row = await context.env.DB
    .prepare(`SELECT slug, name, primaryColor, data, seeded FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<ClubRow>();

  if (!row) return json({ error: "Club not found" }, { status: 404 });

  // Seed from static JSON on first access (awaited so parallel requests see seeded data)
  if (!row.seeded) {
    const origin = new URL(context.request.url).origin;
    await seedClubData(context.env.DB, clubSlug, origin);
    // Re-fetch after seeding
    const seeded = await context.env.DB
      .prepare(`SELECT data FROM club_config WHERE slug = ?`)
      .bind(clubSlug)
      .first<{ data: string | null }>();
    row.data = seeded?.data ?? null;
  }

  const base = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : defaultClub(row.slug, row.name);
  const club = { ...base, slug: row.slug, name: row.name };
  if (row.primaryColor) club.primaryColor = row.primaryColor;

  return json(club);
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const row = await context.env.DB
    .prepare(`SELECT data FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<{ data: string | null }>();

  if (!row) return json({ error: "Club not found" }, { status: 404 });

  const existing = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};
  const body = await context.request.json() as Record<string, unknown>;
  const updated = { ...existing, ...body, slug: clubSlug };

  // Keep club_config.primaryColor in sync so the directory listing reflects the change
  const sets = ['data = ?', 'seeded = 1'];
  const binds: unknown[] = [JSON.stringify(updated)];
  if ('primaryColor' in body) {
    sets.push('primaryColor = ?');
    binds.push(body.primaryColor ?? null);
  }
  binds.push(clubSlug);

  await context.env.DB
    .prepare(`UPDATE club_config SET ${sets.join(', ')} WHERE slug = ?`)
    .bind(...binds)
    .run();

  return json({ ok: true });
};
