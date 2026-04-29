import { type Env, json, nowMs, randomId, requireAdmin, requireManagerOrAdmin, requireAuth, getClubSlug } from "../lib/api-helpers";

type BookingRequestRow = {
  id: string;
  userId: string;
  teamName: string;
  teamSlug: string | null;
  teamLeague: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
  format: string;
  notes: string | null;
  status: string;
  declineReason: string | null;
  createdAt: number;
  updatedAt: number;
};

type BookingRequestWithUser = BookingRequestRow & {
  userName: string;
  userEmail: string;
};

type PitchRow = {
  id: string;
  formats: string;
};

const VALID_FORMATS = ["11v11", "9v9", "7v7", "5v5"];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;

  const { session, role } = result;
  const url = new URL(context.request.url);
  const statusFilter = url.searchParams.get("status");
  const clubSlugFilter = getClubSlug(context.request);

  if (role === "admin") {
    const whereClauses: string[] = [`(br.clubSlug = ? OR (? IS NULL AND br.clubSlug IS NULL))`];
    const binds: unknown[] = [clubSlugFilter, clubSlugFilter];

    if (statusFilter) {
      whereClauses.push(`br.status = ?`);
      binds.push(statusFilter);
    }

    const query = `
      SELECT br.id, br.userId, br.teamName, br.teamSlug, br.teamLeague, br.date, br.timeStart, br.timeEnd,
             br.format, br.notes, br.status, br.declineReason, br.createdAt, br.updatedAt,
             u.name as userName, u.email as userEmail
      FROM booking_request br
      JOIN "user" u ON br.userId = u.id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY br.date ASC, br.timeStart ASC
    `;

    const rows = await context.env.DB
      .prepare(query)
      .bind(...binds)
      .all<BookingRequestWithUser>();

    const requests = rows.results.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      teamName: r.teamName,
      teamSlug: r.teamSlug ?? undefined,
      teamLeague: r.teamLeague ?? undefined,
      date: r.date,
      timeStart: r.timeStart,
      timeEnd: r.timeEnd,
      format: r.format,
      notes: r.notes ?? undefined,
      status: r.status,
      declineReason: r.declineReason ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return json({ requests });
  }

  // Manager: return only their own requests for the current club
  const userId = (session.user as Record<string, unknown>).id as string;
  const managerWhere: string[] = [
    `userId = ?`,
    `(clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`,
  ];
  const binds: unknown[] = [userId, clubSlugFilter, clubSlugFilter];

  if (statusFilter) {
    managerWhere.push(`status = ?`);
    binds.push(statusFilter);
  }

  const query = `
    SELECT id, userId, teamName, teamSlug, teamLeague, date, timeStart, timeEnd,
           format, notes, status, declineReason, createdAt, updatedAt
    FROM booking_request
    WHERE ${managerWhere.join(" AND ")}
    ORDER BY date ASC, timeStart ASC
  `;

  const rows = await context.env.DB
    .prepare(query)
    .bind(...binds)
    .all<BookingRequestRow>();

  const requests = rows.results.map((r) => ({
    id: r.id,
    userId: r.userId,
    teamName: r.teamName,
    teamSlug: r.teamSlug ?? undefined,
    teamLeague: r.teamLeague ?? undefined,
    date: r.date,
    timeStart: r.timeStart,
    timeEnd: r.timeEnd,
    format: r.format,
    notes: r.notes ?? undefined,
    status: r.status,
    declineReason: r.declineReason ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return json({ requests });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireManagerOrAdmin(context);
  if ("error" in result) return result.error;

  const { session } = result;
  const userId = (session.user as Record<string, unknown>).id as string;
  const clubSlug = getClubSlug(context.request);

  const body = (await context.request.json()) as Partial<{
    teamName: string;
    teamSlug: string;
    teamLeague: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    format: string;
    notes: string;
  }>;

  const teamName = body.teamName?.trim() ?? "";
  const teamSlug = body.teamSlug?.trim() ?? null;
  const teamLeague = body.teamLeague?.trim() ?? null;
  const date = body.date?.trim() ?? "";
  const timeStart = body.timeStart?.trim() ?? "";
  const timeEnd = body.timeEnd?.trim() ?? "";
  const format = body.format?.trim() ?? "";
  const notes = body.notes?.trim() ?? null;

  if (!teamName) return json({ error: "teamName is required" }, { status: 400 });
  if (!date) return json({ error: "date is required" }, { status: 400 });
  if (!timeStart) return json({ error: "timeStart is required" }, { status: 400 });
  if (!timeEnd) return json({ error: "timeEnd is required" }, { status: 400 });
  if (!format) return json({ error: "format is required" }, { status: 400 });
  if (!VALID_FORMATS.includes(format)) {
    return json({ error: "format must be one of: 11v11, 9v9, 7v7, 5v5" }, { status: 400 });
  }
  if (timeEnd <= timeStart) {
    return json({ error: "timeEnd must be after timeStart" }, { status: 400 });
  }

  const id = randomId("breq");
  const ts = nowMs();

  await context.env.DB
    .prepare(
      `INSERT INTO booking_request (id, clubSlug, userId, teamName, teamSlug, teamLeague, date, timeStart, timeEnd, format, notes, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(id, clubSlug, userId, teamName, teamSlug, teamLeague, date, timeStart, timeEnd, format, notes, ts, ts)
    .run();

  return json({ ok: true, id }, { status: 201 });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const body = (await context.request.json()) as Partial<{
    action: string;
    pitchId: string;
    timeStart: string;
    timeEnd: string;
    notes: string;
    reason: string;
  }>;

  const action = body.action ?? "";

  if (action === "approve") {
    const pitchId = body.pitchId?.trim() ?? "";
    const timeStart = body.timeStart?.trim() ?? "";
    const timeEnd = body.timeEnd?.trim() ?? "";
    const notes = body.notes?.trim() ?? null;

    if (!pitchId) return json({ error: "pitchId is required for approve" }, { status: 400 });
    if (!timeStart) return json({ error: "timeStart is required for approve" }, { status: 400 });
    if (!timeEnd) return json({ error: "timeEnd is required for approve" }, { status: 400 });

    // Check request exists and is pending
    const request = await context.env.DB
      .prepare(`SELECT id, teamName, teamSlug, teamLeague, date, format FROM booking_request WHERE id = ? AND status = 'pending'`)
      .bind(id)
      .first<{ id: string; teamName: string; teamSlug: string | null; teamLeague: string | null; date: string; format: string }>();

    if (!request) {
      return json({ error: "Booking request not found or not pending" }, { status: 404 });
    }

    // Check pitch exists
    const pitch = await context.env.DB
      .prepare(`SELECT id, formats FROM pitch WHERE id = ?`)
      .bind(pitchId)
      .first<PitchRow>();

    if (!pitch) {
      return json({ error: "Pitch not found" }, { status: 404 });
    }

    // Check pitch supports the request's format
    const pitchFormats = JSON.parse(pitch.formats) as string[];
    if (!pitchFormats.includes(request.format)) {
      return json(
        { error: `Pitch does not support format ${request.format}` },
        { status: 400 }
      );
    }

    // Check for conflicts on the same pitch/date
    const conflict = await context.env.DB
      .prepare(
        `SELECT teamName, timeStart, timeEnd FROM booking
         WHERE pitchId = ? AND date = ? AND timeStart < ? AND timeEnd > ?`
      )
      .bind(pitchId, request.date, timeEnd, timeStart)
      .first<{ teamName: string; timeStart: string; timeEnd: string }>();

    if (conflict) {
      return json(
        { error: `Clash with existing booking: ${conflict.teamName} (${conflict.timeStart}–${conflict.timeEnd})` },
        { status: 409 }
      );
    }

    const ts = nowMs();
    const bookingId = randomId("bkg");

    // Get the full request for denormalised fields
    const fullRequest = await context.env.DB
      .prepare(`SELECT teamName, teamSlug, teamLeague FROM booking_request WHERE id = ?`)
      .bind(id)
      .first<{ teamName: string; teamSlug: string | null; teamLeague: string | null }>();

    if (!fullRequest) {
      return json({ error: "Booking request not found" }, { status: 404 });
    }

    const reqClubSlug = await context.env.DB
      .prepare(`SELECT clubSlug FROM booking_request WHERE id = ?`)
      .bind(id)
      .first<{ clubSlug: string | null }>();

    await context.env.DB.batch([
      context.env.DB
        .prepare(
          `INSERT INTO booking (id, clubSlug, requestId, pitchId, date, timeStart, timeEnd, teamName, teamSlug, teamLeague, format, notes, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          bookingId, reqClubSlug?.clubSlug ?? null, id, pitchId, request.date, timeStart, timeEnd,
          fullRequest.teamName, fullRequest.teamSlug, fullRequest.teamLeague, request.format, notes, ts
        ),
      context.env.DB
        .prepare(
          `UPDATE booking_request SET status = 'approved', updatedAt = ? WHERE id = ?`
        )
        .bind(ts, id),
    ]);

    return json({ ok: true, bookingId });
  }

  if (action === "decline") {
    const reason = body.reason?.trim() ?? null;

    // Check request exists and is pending
    const request = await context.env.DB
      .prepare(`SELECT id FROM booking_request WHERE id = ? AND status = 'pending'`)
      .bind(id)
      .first<{ id: string }>();

    if (!request) {
      return json({ error: "Booking request not found or not pending" }, { status: 404 });
    }

    const ts = nowMs();

    await context.env.DB
      .prepare(
        `UPDATE booking_request SET status = 'declined', declineReason = ?, updatedAt = ? WHERE id = ?`
      )
      .bind(reason, ts, id)
      .run();

    return json({ ok: true });
  }

  return json({ error: "action must be 'approve' or 'decline'" }, { status: 400 });
};
