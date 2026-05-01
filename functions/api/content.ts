import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const body = (await context.request.json()) as { file: string; content: unknown };
  const { file, content } = body;

  if (!file || content === undefined) {
    return json({ error: "file and content required" }, { status: 400 });
  }

  const db = context.env.DB;
  const ts = nowMs();

  try {
    if (file === "website/public/data/news.json") {
      const { items } = content as {
        items: Array<{
          title: string; text: string; body?: string | null;
          link: string; linkText: string; sections?: string[] | null;
        }>;
      };

      const stmts: D1PreparedStatement[] = [
        db.prepare("DELETE FROM news_item WHERE clubSlug IS ? OR clubSlug = ?").bind(clubSlug, clubSlug),
      ];
      for (const item of items ?? []) {
        stmts.push(
          db.prepare(
            `INSERT INTO news_item (id, clubSlug, title, text, body, link, linkText, sections, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            `news_${crypto.randomUUID()}`, clubSlug,
            item.title ?? "", item.text ?? "", item.body ?? null,
            item.link ?? "#", item.linkText ?? "Read more",
            item.sections?.length ? JSON.stringify(item.sections) : null,
            ts, ts
          )
        );
      }
      await db.batch(stmts);
      return json({ ok: true });
    }

    if (file === "website/public/data/committee.json") {
      const { committee } = content as {
        committee: Array<{ role: string; name: string; contact: string }>;
      };

      const stmts: D1PreparedStatement[] = [
        db.prepare("DELETE FROM committee_member WHERE clubSlug IS ? OR clubSlug = ?").bind(clubSlug, clubSlug),
      ];
      for (let i = 0; i < (committee ?? []).length; i++) {
        const member = committee[i];
        stmts.push(
          db.prepare(
            `INSERT INTO committee_member (id, clubSlug, role, name, contact, sortOrder, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            `committee_${crypto.randomUUID()}`, clubSlug,
            member.role ?? "", member.name ?? "TBC", member.contact ?? "TBC",
            i, ts, ts
          )
        );
      }
      await db.batch(stmts);
      return json({ ok: true });
    }

    if (file === "website/public/data/teams.json") {
      const { sections } = content as {
        sections: Array<{
          id: string; name: string; subtitle: string; icon: string; logo?: string | null;
          teams: Array<{
            name: string; description: string; manager: string; coach: string; contact: string;
            photo?: string | null; slug?: string | null; sidebar?: boolean;
            managerLabel?: string | null; coachLabel?: string | null;
          }>;
        }>;
      };

      // Get section IDs for this club first (for cascaded team delete)
      const existingSections = await db
        .prepare("SELECT id FROM team_section WHERE clubSlug IS ? OR clubSlug = ?")
        .bind(clubSlug, clubSlug)
        .all<{ id: string }>();

      const stmts: D1PreparedStatement[] = [];
      if (existingSections.results.length) {
        const placeholders = existingSections.results.map(() => "?").join(", ");
        stmts.push(
          db.prepare(`DELETE FROM team WHERE sectionId IN (${placeholders})`)
            .bind(...existingSections.results.map(r => r.id))
        );
      }
      stmts.push(
        db.prepare("DELETE FROM team_section WHERE clubSlug IS ? OR clubSlug = ?").bind(clubSlug, clubSlug)
      );

      for (let si = 0; si < (sections ?? []).length; si++) {
        const section = sections[si];
        const sectionId = `section_${crypto.randomUUID()}`;
        stmts.push(
          db.prepare(
            `INSERT INTO team_section (id, clubSlug, sectionKey, name, subtitle, icon, logo, sortOrder, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            sectionId, clubSlug, section.id, section.name, section.subtitle ?? "",
            section.icon ?? "fa-shield-alt", section.logo || null, si, ts, ts
          )
        );
        for (let ti = 0; ti < (section.teams ?? []).length; ti++) {
          const team = section.teams[ti];
          stmts.push(
            db.prepare(
              `INSERT INTO team (id, sectionId, name, description, manager, coach, contact, photo, slug, sidebar, managerLabel, coachLabel, sortOrder, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              `team_${crypto.randomUUID()}`, sectionId,
              team.name ?? "", team.description ?? "",
              team.manager ?? "TBC", team.coach ?? "TBC", team.contact ?? "TBC",
              team.photo || null, team.slug || null, team.sidebar ? 1 : 0,
              team.managerLabel || null, team.coachLabel || null, ti, ts, ts
            )
          );
        }
      }
      await db.batch(stmts);
      return json({ ok: true });
    }

    return json({ error: "Invalid file path" }, { status: 400 });
  } catch (err) {
    return json({ error: "Failed to save", details: String(err) }, { status: 500 });
  }
};
