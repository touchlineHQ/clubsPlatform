import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from "../lib/api-helpers";

type CommitteeRow = {
  id: string;
  clubSlug: string | null;
  role: string;
  name: string;
  contact: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

const clubFilter = `(clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  const rows = await context.env.DB
    .prepare(
      `SELECT id, clubSlug, role, name, contact, sortOrder, createdAt, updatedAt
       FROM committee_member
       WHERE ${clubFilter}
       ORDER BY sortOrder ASC, role ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<CommitteeRow>();

  return json({ items: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const body = (await context.request.json()) as Partial<{
    role: string;
    name: string;
    contact: string;
    sortOrder: number;
  }>;

  const role = body.role?.trim() ?? "";
  const name = body.name?.trim() ?? "TBC";
  const contact = body.contact?.trim() ?? "TBC";
  const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;

  if (!role) return json({ error: "role is required" }, { status: 400 });

  const id = randomId("committee");
  const ts = nowMs();
  await context.env.DB
    .prepare(
      `INSERT INTO committee_member (id, clubSlug, role, name, contact, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, clubSlug, role, name, contact, sortOrder, ts, ts)
    .run();

  return json({ ok: true, id }, { status: 201 });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const clubSlug = getClubSlug(context.request);
  const body = (await context.request.json()) as Partial<{
    role: string;
    name: string;
    contact: string;
    sortOrder: number;
  }>;

  const existing = await context.env.DB
    .prepare(`SELECT id FROM committee_member WHERE id = ? AND ${clubFilter}`)
    .bind(id, clubSlug, clubSlug)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Not found" }, { status: 404 });

  const sets: string[] = [];
  const binds: unknown[] = [];

  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  if (body.role !== undefined) set("role", body.role);
  if (body.name !== undefined) set("name", body.name);
  if (body.contact !== undefined) set("contact", body.contact);
  if (body.sortOrder !== undefined) set("sortOrder", body.sortOrder);

  set("updatedAt", nowMs());

  await context.env.DB
    .prepare(`UPDATE committee_member SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, id)
    .run();

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const clubSlug = getClubSlug(context.request);
  const res = await context.env.DB
    .prepare(`DELETE FROM committee_member WHERE id = ? AND ${clubFilter}`)
    .bind(id, clubSlug, clubSlug)
    .run();

  return json({ ok: true, changes: res.meta.changes });
};
