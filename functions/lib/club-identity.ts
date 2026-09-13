import type { D1Database } from "@cloudflare/workers-types";

/**
 * Who a message appears to come from, and where its links point.
 *
 * A parent signed up with their club, not with the platform, and will treat
 * mail from "Clubs Platform" as spam. Every transactional message is addressed
 * from the club and links back into that club's site.
 */
export interface ClubIdentity {
  slug: string;
  /** Display name for the From header. */
  name: string;
  /** Where replies should land, or null when the club has not set a contact address. */
  replyTo: string | null;
}

/**
 * Read a club's mail identity.
 *
 * Note the two columns are not alike. `name` is a real column on
 * `club_config`; the contact address is **not** — it lives inside the `data`
 * JSON blob, which `defaultClub()` in api/club.ts seeds as an empty string.
 * So a club that has never filled in its contact details yields a null
 * replyTo, and callers must cope with that rather than assume an address.
 */
export async function getClubIdentity(
  db: D1Database,
  slug: string,
): Promise<ClubIdentity | null> {
  const row = await db
    .prepare(`SELECT slug, name, data FROM "club_config" WHERE slug = ? AND active = 1 LIMIT 1`)
    .bind(slug)
    .first<{ slug: string; name: string; data: string | null }>();

  if (!row) return null;

  let replyTo: string | null = null;
  if (row.data) {
    try {
      const parsed = JSON.parse(row.data) as { email?: unknown };
      if (typeof parsed.email === "string" && parsed.email.includes("@")) {
        replyTo = parsed.email.trim();
      }
    } catch {
      // Malformed club data is not a reason to fail to send. Reply-to is a
      // convenience; the message still reaches the parent without it.
    }
  }

  return { slug: row.slug, name: row.name, replyTo };
}

/**
 * Build the in-app path for a club route.
 *
 * Two things make this less obvious than it looks. The SPA is a `HashRouter`,
 * so the route lives after a `#` and the server never sees it. And in
 * multi-club mode the club is a real path segment ahead of that hash — miss
 * it and a reset link lands the recipient on the platform directory instead
 * of their own club.
 *
 * Returns a root-relative path, which is also the form better-auth's
 * `originCheck` accepts as a callbackURL.
 */
export function clubPath(
  slug: string | null,
  hashRoute: string,
  multiClub: boolean,
): string {
  const route = hashRoute.startsWith("/") ? hashRoute : `/${hashRoute}`;
  // A platform admin has no club of their own, so there is no prefix to add.
  return multiClub && slug ? `/${slug}/#${route}` : `/#${route}`;
}

/** The same path as an absolute URL, for putting in an email. */
export function clubLink(
  baseURL: string,
  slug: string | null,
  hashRoute: string,
  multiClub: boolean,
): string {
  const origin = new URL(baseURL).origin;
  return `${origin}${clubPath(slug, hashRoute, multiClub)}`;
}
