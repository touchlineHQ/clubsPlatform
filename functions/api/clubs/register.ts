import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, nowMs, randomId, requireAuth, isMultiClubMode } from "../../lib/api-helpers";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }

  await ensureTables(context.env.DB);

  const result = await requireAuth(context);
  if ("error" in result) return result.error;

  const { session } = result;
  const userId = session.user.id as string;

  const body = (await context.request.json()) as Partial<{ clubName: string }>;
  const clubName = body.clubName?.trim() ?? "";

  if (!clubName) {
    return json({ error: "clubName is required" }, { status: 400 });
  }

  let slug = slugify(clubName);
  if (!slug) {
    return json({ error: "Club name could not be converted to a valid slug" }, { status: 400 });
  }

  // Ensure slug uniqueness — append a suffix if taken
  const existing = await context.env.DB
    .prepare(`SELECT slug FROM club_config WHERE slug LIKE ?`)
    .bind(`${slug}%`)
    .all<{ slug: string }>();

  const takenSlugs = new Set(existing.results.map(r => r.slug));
  if (takenSlugs.has(slug)) {
    let suffix = 2;
    while (takenSlugs.has(`${slug}-${suffix}`)) suffix++;
    slug = `${slug}-${suffix}`;
  }

  const id = randomId("club");
  await context.env.DB
    .prepare(`INSERT INTO club_config (id, slug, name, active, createdAt) VALUES (?, ?, ?, 1, ?)`)
    .bind(id, slug, clubName, nowMs())
    .run();

  // Grant the signing-up user admin access to this club
  await context.env.DB
    .prepare(`UPDATE user SET role = 'admin', clubSlug = ? WHERE id = ?`)
    .bind(slug, userId)
    .run();

  return json({ ok: true, slug }, { status: 201 });
};
