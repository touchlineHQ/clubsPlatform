import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from "../lib/api-helpers";

type TeamSectionRow = {
  id: string;
  clubSlug: string | null;
  sectionKey: string;
  name: string;
  subtitle: string;
  icon: string;
  logo: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

type TeamRow = {
  id: string;
  sectionId: string;
  name: string;
  description: string;
  manager: string;
  coach: string;
  contact: string;
  photo: string | null;
  slug: string | null;
  sidebar: number;
  managerLabel: string | null;
  coachLabel: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

const clubFilter = `(ts.clubSlug = ? OR (? IS NULL AND ts.clubSlug IS NULL))`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);

  const sections = await context.env.DB
    .prepare(
      `SELECT id, clubSlug, sectionKey, name, subtitle, icon, logo, sortOrder, createdAt, updatedAt
       FROM team_section ts
       WHERE (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))
         AND sectionKey != 'imported'
       ORDER BY sortOrder ASC, name ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<TeamSectionRow>();

  // Fetch teams for sections belonging to this club
  const sectionIds = sections.results.map(s => s.id);
  if (!sectionIds.length) return json({ sections: [], teams: [] });

  const placeholders = sectionIds.map(() => "?").join(", ");
  const teams = await context.env.DB
    .prepare(
      `SELECT id, sectionId, name, description, manager, coach, contact, photo, slug, sidebar, managerLabel, coachLabel, sortOrder, createdAt, updatedAt
       FROM team
       WHERE sectionId IN (${placeholders})
         AND forConsolidation = 0
       ORDER BY sectionId ASC, sortOrder ASC, name ASC`
    )
    .bind(...sectionIds)
    .all<TeamRow>();

  return json({ sections: sections.results, teams: teams.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const body = (await context.request.json()) as Record<string, unknown>;
  const type = String(body.type ?? "");
  const ts = nowMs();

  if (type === "section") {
    const sectionKey = String(body.sectionKey ?? "").trim();
    const name = String(body.name ?? "").trim();
    const subtitle = String(body.subtitle ?? "").trim();
    const icon = String(body.icon ?? "fa-shield-alt").trim();
    const logo = body.logo === undefined ? null : String(body.logo || "");
    const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;

    if (!sectionKey || !name) return json({ error: "sectionKey and name are required" }, { status: 400 });

    const id = randomId("section");
    await context.env.DB
      .prepare(
        `INSERT INTO team_section (id, clubSlug, sectionKey, name, subtitle, icon, logo, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, clubSlug, sectionKey, name, subtitle, icon, logo || null, sortOrder, ts, ts)
      .run();

    return json({ ok: true, id }, { status: 201 });
  }

  if (type === "team") {
    const sectionId = String(body.sectionId ?? "").trim();
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const manager = String(body.manager ?? "TBC").trim();
    const coach = String(body.coach ?? "TBC").trim();
    const contact = String(body.contact ?? "TBC").trim();
    const photo = body.photo === undefined ? null : String(body.photo || "");
    const slug = body.slug === undefined ? null : String(body.slug || "");
    const sidebar = body.sidebar ? 1 : 0;
    const managerLabel = body.managerLabel === undefined ? null : String(body.managerLabel || "");
    const coachLabel = body.coachLabel === undefined ? null : String(body.coachLabel || "");
    const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;

    if (!sectionId || !name) return json({ error: "sectionId and name are required" }, { status: 400 });

    // Verify the section belongs to the correct club
    const exists = await context.env.DB
      .prepare(`SELECT id FROM team_section WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`)
      .bind(sectionId, clubSlug, clubSlug)
      .first<{ id: string }>();
    if (!exists) return json({ error: "Invalid sectionId" }, { status: 400 });

    const id = randomId("team");
    await context.env.DB
      .prepare(
        `INSERT INTO team (id, sectionId, name, description, manager, coach, contact, photo, slug, sidebar, managerLabel, coachLabel, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, sectionId, name, description, manager, coach, contact,
        photo || null, slug || null, sidebar, managerLabel || null,
        coachLabel || null, sortOrder, ts, ts
      )
      .run();

    return json({ ok: true, id }, { status: 201 });
  }

  return json({ error: "type must be 'section' or 'team'" }, { status: 400 });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!type || !id) return json({ error: "type and id query params required" }, { status: 400 });

  const clubSlug = getClubSlug(context.request);
  const body = (await context.request.json()) as Record<string, unknown>;
  const ts = nowMs();

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  if (type === "section") {
    const existing = await context.env.DB
      .prepare(`SELECT id FROM team_section WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`)
      .bind(id, clubSlug, clubSlug)
      .first<{ id: string }>();
    if (!existing) return json({ error: "Not found" }, { status: 404 });

    if (body.sectionKey !== undefined) set("sectionKey", String(body.sectionKey));
    if (body.name !== undefined) set("name", String(body.name));
    if (body.subtitle !== undefined) set("subtitle", String(body.subtitle));
    if (body.icon !== undefined) set("icon", String(body.icon));
    if (body.logo !== undefined) set("logo", body.logo ? String(body.logo) : null);
    if (body.sortOrder !== undefined) set("sortOrder", Number(body.sortOrder));
    set("updatedAt", ts);

    await context.env.DB
      .prepare(`UPDATE team_section SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, id)
      .run();
    return json({ ok: true });
  }

  if (type === "team") {
    // Verify the team's section belongs to the correct club
    const existing = await context.env.DB
      .prepare(
        `SELECT t.id FROM team t
         JOIN team_section ts ON ts.id = t.sectionId
         WHERE t.id = ? AND (ts.clubSlug = ? OR (? IS NULL AND ts.clubSlug IS NULL))`
      )
      .bind(id, clubSlug, clubSlug)
      .first<{ id: string }>();
    if (!existing) return json({ error: "Not found" }, { status: 404 });

    if (body.sectionId !== undefined) set("sectionId", String(body.sectionId));
    if (body.name !== undefined) set("name", String(body.name));
    if (body.description !== undefined) set("description", String(body.description));
    if (body.manager !== undefined) set("manager", String(body.manager));
    if (body.coach !== undefined) set("coach", String(body.coach));
    if (body.contact !== undefined) set("contact", String(body.contact));
    if (body.photo !== undefined) set("photo", body.photo ? String(body.photo) : null);
    if (body.slug !== undefined) set("slug", body.slug ? String(body.slug) : null);
    if (body.sidebar !== undefined) set("sidebar", body.sidebar ? 1 : 0);
    if (body.managerLabel !== undefined) set("managerLabel", body.managerLabel ? String(body.managerLabel) : null);
    if (body.coachLabel !== undefined) set("coachLabel", body.coachLabel ? String(body.coachLabel) : null);
    if (body.sortOrder !== undefined) set("sortOrder", Number(body.sortOrder));
    set("updatedAt", ts);

    await context.env.DB
      .prepare(`UPDATE team SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, id)
      .run();
    return json({ ok: true });
  }

  return json({ error: "type must be 'section' or 'team'" }, { status: 400 });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!type || !id) return json({ error: "type and id query params required" }, { status: 400 });

  const clubSlug = getClubSlug(context.request);

  if (type === "section") {
    const res = await context.env.DB
      .prepare(`DELETE FROM team_section WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`)
      .bind(id, clubSlug, clubSlug)
      .run();
    return json({ ok: true, changes: res.meta.changes });
  }

  if (type === "team") {
    // Verify the team belongs to the correct club before deleting
    const existing = await context.env.DB
      .prepare(
        `SELECT t.id FROM team t
         JOIN team_section ts ON ts.id = t.sectionId
         WHERE t.id = ? AND (ts.clubSlug = ? OR (? IS NULL AND ts.clubSlug IS NULL))`
      )
      .bind(id, clubSlug, clubSlug)
      .first<{ id: string }>();
    if (!existing) return json({ ok: true, changes: 0 });

    const res = await context.env.DB
      .prepare(`DELETE FROM team WHERE id = ?`)
      .bind(id)
      .run();
    return json({ ok: true, changes: res.meta.changes });
  }

  return json({ error: "type must be 'section' or 'team'" }, { status: 400 });
};
