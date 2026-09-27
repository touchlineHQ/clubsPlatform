import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, getClubSlug } from "../lib/api-helpers";
import { buildPrivacyNotice } from "../lib/privacy-notice";

type ClubRow = {
  slug: string;
  name: string;
  data: string | null;
};

/**
 * Per-club privacy notice naming the club as controller (#75).
 * Public — consent is only informed when the notice is reachable without login.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const row = await context.env.DB
    .prepare(`SELECT slug, name, data FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<ClubRow>();

  if (!row) return json({ error: "Club not found" }, { status: 404 });

  let email: string | null = null;
  let address: { line1?: string; line2?: string; postcode?: string } | null = null;
  if (row.data) {
    try {
      const parsed = JSON.parse(row.data) as {
        email?: string;
        address?: { line1?: string; line2?: string; postcode?: string };
      };
      email = typeof parsed.email === "string" ? parsed.email : null;
      address = parsed.address ?? null;
    } catch {
      // Ignore malformed club data blobs; notice still names the club.
    }
  }

  return json(buildPrivacyNotice({
    slug: row.slug,
    name: row.name,
    email,
    address,
  }));
};
