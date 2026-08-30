import { ensureTables } from "../lib/ensure-tables";
import { prepareAuditLog } from "../lib/audit-log";
import { clubPublicationUnavailable, isClubPublicationSchemaReady } from "../lib/club-publication";
import { seedClubData } from "../lib/seed";
import { type Env, json, getClubSlug, requireAdmin } from "../lib/api-helpers";

type ClubRow = {
  slug: string;
  name: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  data: string | null;
  seeded: number;
  published: number;
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

  // The fallback keeps this working against a production DB that hasn't had
  // migration 0021 applied yet — see the same pattern in api/clubs.ts.
  const loadClub = (publishedColumn: string) => context.env.DB
    .prepare(`SELECT slug, name, primaryColor, secondaryColor, data, seeded, ${publishedColumn} FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<ClubRow>();

  let row: ClubRow | null;
  try {
    row = await loadClub('published');
  } catch {
    row = await loadClub('1 AS published');
  }

  if (!row) return json({ error: "Club not found" }, { status: 404 });

  // A club that hasn't gone live yet serves its content to its own admins only.
  // Everyone else gets the same 404 as a club that doesn't exist, so the
  // response never confirms a private club is there. The session lookup only
  // happens for unpublished clubs — a live club pays nothing for this.
  if (row.published === 0) {
    const admin = await requireAdmin(context);
    if ("error" in admin) return json({ error: "Club not found" }, { status: 404 });
  }

  // Seed from static JSON on first access (awaited so parallel requests see seeded data)
  if (!row.seeded) {
    const origin = new URL(context.request.url).origin;
    await seedClubData(context.env.DB, clubSlug, origin, context.env.ASSETS);
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
  if (row.secondaryColor) club.secondaryColor = row.secondaryColor;

  return json(club);
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let parsedBody: unknown;
  try {
    parsedBody = await context.request.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;
  if ('published' in body && typeof body.published !== 'boolean') {
    return json({ error: "published must be a boolean" }, { status: 400 });
  }

  // Only a go-live touches `published`, so only a go-live needs the column to
  // exist. Every other save through this endpoint — which is every content save
  // the Customise page makes — must keep working against a database that hasn't
  // had migration 0021 applied yet, so it never names the column at all.
  const changesPublication = 'published' in body;
  if (changesPublication && !(await isClubPublicationSchemaReady(context.env.DB))) {
    return clubPublicationUnavailable();
  }

  const row = await context.env.DB
    .prepare(`SELECT id, data${changesPublication ? ', published' : ''} FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<{ id: string; data: string | null; published?: number }>();

  if (!row) return json({ error: "Club not found" }, { status: 404 });

  const existing = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};

  // `published` is a column, not part of the club's content — keep it out of
  // the JSON blob so the two can never disagree about whether a site is live.
  const { published: _published, ...blobBody } = body;
  const updated = { ...existing, ...blobBody, slug: clubSlug };

  // Keep club_config.primaryColor / secondaryColor in sync so the directory
  // listing reflects the change without needing to re-parse the JSON blob.
  const sets = ['data = ?', 'seeded = 1'];
  const binds: unknown[] = [JSON.stringify(updated)];
  if ('primaryColor' in body) {
    sets.push('primaryColor = ?');
    binds.push(body.primaryColor ?? null);
  }
  if ('secondaryColor' in body) {
    sets.push('secondaryColor = ?');
    binds.push(body.secondaryColor ?? null);
  }
  // Going live lives here rather than on PATCH /api/clubs because that handler
  // is gated on multi-club mode, and a single-club fork needs the switch too.
  if (changesPublication) {
    sets.push('published = ?');
    binds.push(body.published === true ? 1 : 0);
  }
  binds.push(clubSlug);

  const update = context.env.DB
    .prepare(`UPDATE club_config SET ${sets.join(', ')} WHERE slug = ?`)
    .bind(...binds);

  // Taking a club's site public (or pulling it back) is the kind of change a
  // club will later want to trace to a person and a time, so it goes in the
  // audit log alongside the payment overrides.
  const wasPublished = row.published !== 0;
  if (changesPublication && body.published !== wasPublished) {
    const audit = prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId: (result.session.user as Record<string, unknown>).id as string,
      action: body.published === true ? 'club.publish' : 'club.unpublish',
      targetTable: 'club_config',
      targetId: row.id,
      oldStatus: wasPublished ? 'published' : 'private',
      newStatus: body.published === true ? 'published' : 'private',
    });
    await context.env.DB.batch([update, audit]);
  } else {
    await update.run();
  }

  return json({ ok: true });
};
