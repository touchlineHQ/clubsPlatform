import { D1Database } from "@cloudflare/workers-types";

type AnyRow = Record<string, unknown>;
type AssetFetcher = { fetch(req: Request | string): Promise<Response> };

async function fetchJson(assets: AssetFetcher, url: string): Promise<AnyRow | null> {
  try {
    const res = await assets.fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return null;
    return JSON.parse(text) as AnyRow;
  } catch {
    return null;
  }
}

/**
 * Seed all static JSON data for a club into the DB on first access.
 * Sets seeded=1 on club_config so this only runs once per club.
 * Safe to call concurrently — the UPDATE is atomic.
 * Uses the ASSETS binding to read static files directly without HTTP.
 */
export async function seedClubData(db: D1Database, slug: string, origin: string, assets: AssetFetcher): Promise<void> {
  // Claim the seeding slot atomically — only one request wins
  const result = await db
    .prepare(`UPDATE club_config SET seeded = 1 WHERE slug = ? AND seeded = 0`)
    .bind(slug)
    .run();

  if (result.meta.changes === 0) return; // another request already seeding

  const base = `${origin}/data/clubs/${slug}`;
  const ts = Date.now();

  // ── club.json ────────────────────────────────────────────────────────────
  const clubData = await fetchJson(assets, `${base}/club.json`);
  if (clubData) {
    await db
      .prepare(`UPDATE club_config SET data = ? WHERE slug = ?`)
      .bind(JSON.stringify(clubData), slug)
      .run();
  }

  const stmts: D1PreparedStatement[] = [];

  // ── registration.json ────────────────────────────────────────────────────
  const regData = await fetchJson(assets, `${base}/registration.json`);
  const regItems = (regData?.items ?? []) as Array<AnyRow>;
  for (let i = 0; i < regItems.length; i++) {
    const item = regItems[i];
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO registration_item (id, clubSlug, icon, title, description, link, buttonText, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `reg_${crypto.randomUUID()}`, slug,
        item.icon ?? '', item.title ?? '', item.description ?? '',
        item.link ?? '#', item.buttonText ?? 'Find out more', i, ts, ts
      )
    );
  }

  // ── gallery.json ─────────────────────────────────────────────────────────
  const galleryData = await fetchJson(assets, `${base}/gallery.json`);
  const galleryItems = (galleryData?.items ?? []) as Array<AnyRow>;
  for (let i = 0; i < galleryItems.length; i++) {
    const item = galleryItems[i];
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO gallery_item (id, clubSlug, src, caption, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `gallery_${crypto.randomUUID()}`, slug,
        item.src ?? null, item.caption ?? '', i, ts, ts
      )
    );
  }

  // ── matchday.json ─────────────────────────────────────────────────────────
  const matchdayData = await fetchJson(assets, `${base}/matchday.json`);
  const matchdayItems = (matchdayData?.items ?? []) as Array<AnyRow>;
  for (let i = 0; i < matchdayItems.length; i++) {
    const item = matchdayItems[i];
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO matchday_item (id, clubSlug, icon, title, text, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `matchday_${crypto.randomUUID()}`, slug,
        item.icon ?? '', item.title ?? '', item.text ?? '', i, ts, ts
      )
    );
  }

  // ── news.json ─────────────────────────────────────────────────────────────
  const newsData = await fetchJson(assets, `${base}/news.json`);
  const newsItems = (newsData?.items ?? []) as Array<AnyRow>;
  for (const item of newsItems) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO news_item (id, clubSlug, title, text, body, link, linkText, sections, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `news_${crypto.randomUUID()}`, slug,
        item.title ?? '', item.text ?? '', item.body ?? null,
        item.link ?? '#', item.linkText ?? 'Read more',
        item.sections ? JSON.stringify(item.sections) : null,
        ts, ts
      )
    );
  }

  // ── teams.json ────────────────────────────────────────────────────────────
  const teamsData = await fetchJson(assets, `${base}/teams.json`);
  const sections = (teamsData?.sections ?? []) as Array<AnyRow>;
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const sectionId = `section_${crypto.randomUUID()}`;
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO team_section (id, clubSlug, sectionKey, name, subtitle, icon, logo, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sectionId, slug,
        section.id ?? '', section.name ?? '', section.subtitle ?? '',
        section.icon ?? 'fa-shield-alt', section.logo ?? null, si, ts, ts
      )
    );
    const teams = (section.teams ?? []) as Array<AnyRow>;
    for (let ti = 0; ti < teams.length; ti++) {
      const team = teams[ti];
      stmts.push(
        db.prepare(
          `INSERT OR IGNORE INTO team (id, sectionId, name, description, manager, coach, contact, photo, slug, sidebar, managerLabel, coachLabel, sortOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          `team_${crypto.randomUUID()}`, sectionId,
          team.name ?? '', team.description ?? '',
          team.manager ?? 'TBC', team.coach ?? 'TBC', team.contact ?? 'TBC',
          team.photo ?? null, team.slug ?? null, team.sidebar ? 1 : 0,
          team.managerLabel ?? null, team.coachLabel ?? null, ti, ts, ts
        )
      );
    }
  }

  // ── committee.json ────────────────────────────────────────────────────────
  const committeeData = await fetchJson(assets, `${base}/committee.json`);
  const committeeMembers = (committeeData?.committee ?? []) as Array<AnyRow>;
  for (let i = 0; i < committeeMembers.length; i++) {
    const member = committeeMembers[i];
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO committee_member (id, clubSlug, role, name, contact, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `committee_${crypto.randomUUID()}`, slug,
        member.role ?? '', member.name ?? 'TBC', member.contact ?? 'TBC', i, ts, ts
      )
    );
  }

  if (stmts.length) await db.batch(stmts);
}
