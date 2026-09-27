import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, getClubSlug } from "../lib/api-helpers";
import { buildPrivacyNotice } from "../lib/privacy-notice";

type ClubRow = {
  slug: string;
  name: string;
  data: string | null;
};

/**
 * Per-club privacy notice naming the club as controller (#75 / #146).
 * Public — reachable without login. Always available once the club exists;
 * published contact details are optional extras, not a gate.
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
      const parsed = JSON.parse(row.data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const data = parsed as Record<string, unknown>;
        email = typeof data.email === "string" ? data.email : null;
        if (data.address && typeof data.address === "object" && !Array.isArray(data.address)) {
          const raw = data.address as Record<string, unknown>;
          address = {
            line1: typeof raw.line1 === "string" ? raw.line1 : undefined,
            line2: typeof raw.line2 === "string" ? raw.line2 : undefined,
            postcode: typeof raw.postcode === "string" ? raw.postcode : undefined,
          };
        }
      }
    } catch {
      // Malformed data cannot supply controller contact details.
    }
  }

  return json(buildPrivacyNotice({
    slug: row.slug,
    name: row.name,
    email,
    address,
  }));
};
