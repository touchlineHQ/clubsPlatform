import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";

type BookingRow = {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  teamName: string;
  teamSlug: string | null;
  teamLeague: string | null;
  format: string;
  notes: string | null;
  pitchName: string;
  pitchId: string;
  createdAt: number;
  requestId: string | null;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  const month = url.searchParams.get("month");

  const whereClauses: string[] = [`(b.clubSlug = ? OR (? IS NULL AND b.clubSlug IS NULL))`];
  const binds: unknown[] = [clubSlug, clubSlug];

  if (date) {
    whereClauses.push(`b.date = ?`);
    binds.push(date);
  } else if (month) {
    whereClauses.push(`b.date LIKE ?`);
    binds.push(`${month}-%`);
  }

  const query = `
    SELECT b.id, b.date, b.timeStart, b.timeEnd, b.teamName, b.teamSlug, b.teamLeague, b.format, b.notes,
           b.createdAt, b.requestId, p.name as pitchName, p.id as pitchId
    FROM booking b
    JOIN pitch p ON b.pitchId = p.id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY b.date ASC, b.timeStart ASC
  `;

  const rows = await context.env.DB.prepare(query).bind(...binds).all<BookingRow>();

  const bookings = rows.results.map((r) => ({
    id: r.id,
    date: r.date,
    timeStart: r.timeStart,
    timeEnd: r.timeEnd,
    teamName: r.teamName,
    teamSlug: r.teamSlug ?? undefined,
    teamLeague: r.teamLeague ?? undefined,
    format: r.format,
    notes: r.notes ?? undefined,
    pitchName: r.pitchName,
    pitchId: r.pitchId,
    createdAt: r.createdAt,
    requestId: r.requestId ?? undefined,
  }));

  return json({ bookings });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const clubSlug = getClubSlug(context.request);
  const ts = nowMs();

  // Verify booking belongs to this club before deleting
  const booking = await context.env.DB
    .prepare(`SELECT id FROM booking WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`)
    .bind(id, clubSlug, clubSlug)
    .first<{ id: string }>();
  if (!booking) return json({ error: "Not found" }, { status: 404 });

  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE booking_request SET status = 'pending', updatedAt = ?
         WHERE id = (SELECT requestId FROM booking WHERE id = ?)`
      )
      .bind(ts, id),
    context.env.DB
      .prepare(`DELETE FROM booking WHERE id = ?`)
      .bind(id),
  ]);

  return json({ ok: true });
};
