import type { D1Database } from "@cloudflare/workers-types";

/**
 * Who a transactional email is *from*, and where its links point.
 *
 * A parent signed up with their club, not with the platform, so mail that
 * arrives as "Club Platform" reads as spam. The From address stays on the
 * platform's verified sending domain — a grassroots club cannot verify one it
 * does not own — but the display name and the reply-to come from the club.
 */
export interface ClubIdentity {
  slug: string;
  /** Display name for the From header, e.g. "East Leake FC". */
  name: string;
  /** The club's own contact address, when it has set one. */
  replyTo: string | null;
}

/**
 * Look up a club's mail identity. Returns null for a user with no club — a
 * platform admin — so the caller falls back to the platform defaults.
 */
export async function loadClubIdentity(
  db: D1Database,
  clubSlug: string | null | undefined,
): Promise<ClubIdentity | null> {
  if (!clubSlug) return null;

  const row = await db
    .prepare(`SELECT name, data FROM "club_config" WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<{ name: string; data: string | null }>();
  if (!row) return null;

  let replyTo: string | null = null;
  if (row.data) {
    try {
      const parsed = JSON.parse(row.data) as { email?: unknown };
      if (typeof parsed.email === "string" && parsed.email.trim()) {
        replyTo = parsed.email.trim();
      }
    } catch {
      // A club whose content blob is unparseable still gets mail, just without
      // a reply-to. Never let it stop a password reset going out.
    }
  }

  return { slug: clubSlug, name: row.name, replyTo };
}

/**
 * Build a link into a club's site.
 *
 * Two things make this less obvious than it looks: the app is a HashRouter, so
 * the route lives in the fragment; and in multi-club mode each club is served
 * under its own first path segment, which a bare `${origin}/#/…` link would
 * miss — landing the recipient on the platform directory instead of their club.
 */
export function clubAppUrl(opts: {
  origin: string;
  clubSlug: string | null | undefined;
  multiClub: boolean;
  /** In-app route including the leading slash, e.g. `/reset-password`. */
  route: string;
  query?: Record<string, string>;
}): string {
  const base = opts.origin.replace(/\/+$/, "");
  const prefix = opts.multiClub && opts.clubSlug ? `/${encodeURIComponent(opts.clubSlug)}` : "";
  const search = opts.query ? new URLSearchParams(opts.query).toString() : "";
  return `${base}${prefix}/#${opts.route}${search ? `?${search}` : ""}`;
}
