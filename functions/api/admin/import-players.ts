import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { hashPwd } from "../../lib/auth";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { normaliseTeamName } from "../../lib/team-name";

export interface ParsedPlayerRow {
  fanId: string;
  ageGroup: string;
  teamName: string;
  registrationExpiry: string;
  registrationStatus: string;
  playerEmail: string;   // may be empty
  parentEmails: string[]; // split and trimmed
}

/** A registration held in D1 that the uploaded file no longer mentions. */
export interface StaleRegistration {
  fanId: string;
  teamName: string;
  registrationStatus: string | null;
}

interface ImportResult {
  ok: boolean;
  /** Player identity rows inserted. A returning player counts in neither field. */
  players: { created: number };
  registrations: { created: number; updated: number };
  users: { created: number; skipped: number };
  errors: { fanId: string; reason: string }[];
  stale: { count: number; rows: StaleRegistration[] };
}

export const IMPORT_LIMITS = {
  maxRows: 5000,
  maxStringLen: 200,
  maxParentEmails: 10,
} as const;

function isStringOrMissing(v: unknown, max: number): boolean {
  if (v === undefined || v === null) return true;
  return typeof v === 'string' && v.length <= max;
}

function validateImportRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return 'row is not an object';
  const r = row as Record<string, unknown>;
  if (typeof r.fanId !== 'string' || !r.fanId.trim()) return 'fanId is required';
  if (r.fanId.length > IMPORT_LIMITS.maxStringLen) return 'fanId is too long';
  if (!isStringOrMissing(r.ageGroup, IMPORT_LIMITS.maxStringLen)) return 'ageGroup is invalid';
  if (!isStringOrMissing(r.teamName, IMPORT_LIMITS.maxStringLen)) return 'teamName is invalid';
  if (!isStringOrMissing(r.registrationExpiry, IMPORT_LIMITS.maxStringLen)) return 'registrationExpiry is invalid';
  if (!isStringOrMissing(r.registrationStatus, IMPORT_LIMITS.maxStringLen)) return 'registrationStatus is invalid';
  if (!isStringOrMissing(r.playerEmail, IMPORT_LIMITS.maxStringLen)) return 'playerEmail is invalid';
  if (r.parentEmails !== undefined && r.parentEmails !== null) {
    if (!Array.isArray(r.parentEmails)) return 'parentEmails must be an array';
    if (r.parentEmails.length > IMPORT_LIMITS.maxParentEmails) return 'too many parent emails';
    for (const pe of r.parentEmails) {
      if (typeof pe !== 'string' || pe.length > IMPORT_LIMITS.maxStringLen) {
        return 'parentEmails contains an invalid value';
      }
    }
  }
  return null;
}

/**
 * What one uploaded row resolves to, worked out without touching the database.
 *
 * `createPlayer` / `existingRegId` are decided once, in the read-only planning
 * pass, so that a dry run and the real import agree on every count. Doing the
 * decision inline with the writes (as this handler used to) makes that
 * impossible: the first row's INSERT is what made the second row's SELECT find
 * the player, so a read-only pass would count the same creation twice.
 */
interface RowPlan {
  fanId: string;
  playerId: string;
  createPlayer: boolean;
  teamName: string;
  ageGroup: string | null;
  expiry: string | null;
  status: string | null;
  /** Set when the registration already exists (or an earlier row will create it). */
  existingRegId: string | null;
  /** Set when this row is the one that inserts the registration. */
  newRegId: string | null;
}

interface UserPlan {
  email: string;
  existingUserId: string | null;
  newUserId: string;
  passwordFan: string;
  fanMap: Map<string, "self" | "guardian">;
}

/**
 * One slice of a chunked import.
 *
 * Seeding a new user's password costs ~47ms of CPU (lib/auth.ts hashes the FAN
 * with PBKDF2 at 100k iterations), and Cloudflare bills that against a per-request
 * CPU limit — so a whole-club import in one request runs out of CPU part-way
 * through and leaves the club half-imported. The client sends slices instead.
 *
 * Absent means an unchunked import, which behaves exactly as it always did.
 */
interface ImportPart {
  index: number;
  total: number;
  /** Rows in the whole file, not this slice — for the import-log stamp. */
  totalRows: number;
}

function validatePart(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return 'part must be an object';
  const p = v as Record<string, unknown>;
  for (const k of ['index', 'total', 'totalRows'] as const) {
    if (!Number.isInteger(p[k]) || (p[k] as number) < 0) return `part.${k} must be a non-negative integer`;
  }
  if ((p.index as number) >= (p.total as number)) return 'part.index must be less than part.total';
  return null;
}

/**
 * D1 caps a query at 100 bound parameters, so an `IN (…)` list over a whole
 * club's worth of values has to be issued in slices.
 */
const MAX_BOUND_PARAMS = 90;

function inSlices<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += MAX_BOUND_PARAMS) {
    out.push(values.slice(i, i + MAX_BOUND_PARAMS));
  }
  return out;
}

/** A registration as D1 currently holds it. */
interface HeldRegistration {
  id: string;
  playerId: string;
  fanId: string;
  teamName: string;
  registrationStatus: string | null;
}

/** Key for "this player, this team", on the normalised team name. */
const regKey = (fanId: string, teamName: string) =>
  JSON.stringify([fanId, normaliseTeamName(teamName)]);

/** Preview or commit a player import for the authenticated club administrator. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Club slug required" }, { status: 400 });

  await ensureTables(context.env.DB);

  let rows: ParsedPlayerRow[];
  let dryRun: boolean;
  let part: ImportPart | null;
  try {
    const body = await context.request.json() as { rows?: unknown; dryRun?: unknown; part?: unknown };
    if (!Array.isArray(body.rows)) {
      return json({ error: "Expected { rows: [] }" }, { status: 400 });
    }
    if (body.rows.length > IMPORT_LIMITS.maxRows) {
      return json(
        { error: `Too many rows (max ${IMPORT_LIMITS.maxRows})` },
        { status: 400 },
      );
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      return json({ error: "dryRun must be a boolean" }, { status: 400 });
    }
    const partError = validatePart(body.part);
    if (partError) return json({ error: partError }, { status: 400 });
    for (let i = 0; i < body.rows.length; i++) {
      const err = validateImportRow(body.rows[i]);
      if (err) {
        return json({ error: `Row ${i}: ${err}` }, { status: 400 });
      }
    }
    rows = body.rows as ParsedPlayerRow[];
    dryRun = body.dryRun === true;
    part = (body.part as ImportPart | undefined) ?? null;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  /** The slice that stamps the import and reports the run to analytics. */
  const isFinalPart = !part || part.index === part.total - 1;

  const db = context.env.DB;
  const importResult: ImportResult = {
    ok: true,
    players: { created: 0 },
    registrations: { created: 0, updated: 0 },
    users: { created: 0, skipped: 0 },
    errors: [],
    stale: { count: 0, rows: [] },
  };

  // ── 1. Pre-process: build email→player maps ──────────────────────────────
  // email → Map<fanId, relationship>
  const emailRelMap = new Map<string, Map<string, "self" | "guardian">>();
  // email that appears as player's own email → that player's fanId (for password)
  const selfEmailToFan = new Map<string, string>();

  for (const row of rows) {
    const fanId = String(row.fanId ?? "").trim();
    if (!fanId) continue;

    const playerEmail = String(row.playerEmail ?? "").trim().toLowerCase();
    if (playerEmail) {
      if (!emailRelMap.has(playerEmail)) emailRelMap.set(playerEmail, new Map());
      emailRelMap.get(playerEmail)!.set(fanId, "self");
      selfEmailToFan.set(playerEmail, fanId);
    }

    for (const raw of row.parentEmails ?? []) {
      const pe = raw.trim().toLowerCase();
      if (!pe) continue;
      if (!emailRelMap.has(pe)) emailRelMap.set(pe, new Map());
      // Only set guardian if not already marked self for this fanId
      if (!emailRelMap.get(pe)!.has(fanId)) {
        emailRelMap.get(pe)!.set(fanId, "guardian");
      }
    }
  }

  // ── 2. Determine password FAN for each email ─────────────────────────────
  const emailToPasswordFan = new Map<string, string>();
  for (const [email, fanMap] of emailRelMap) {
    if (selfEmailToFan.has(email)) {
      emailToPasswordFan.set(email, selfEmailToFan.get(email)!);
    } else {
      // Guardian-only: use numerically smallest FAN
      const sorted = [...fanMap.keys()].sort((a, b) => Number(a) - Number(b));
      if (sorted.length > 0) emailToPasswordFan.set(email, sorted[0]);
    }
  }

  // ── 3. Read what the club already holds ──────────────────────────────────
  // One query serves two jobs: it is the index the upsert matches against, and
  // it is the set the stale list is subtracted from. Doing both from the same
  // rows is what keeps the two consistent — matching registrations on the raw
  // team name while computing staleness on the normalised one would quietly
  // create a duplicate registration for every "Under  13"/"Under 13" variant
  // and then report neither as stale.
  const heldRegistrations = await db
    .prepare(
      `SELECT pr.id AS id, pr.playerId AS playerId, p.fanId AS fanId,
              pr.teamName AS teamName, pr.registrationStatus AS registrationStatus
         FROM "player_registration" pr
         JOIN "player" p ON p.id = pr.playerId
        WHERE pr.clubSlug = ?
        ORDER BY pr.teamName ASC, p.fanId ASC`,
    )
    .bind(clubSlug)
    .all<HeldRegistration>();

  const held = heldRegistrations.results ?? [];
  const heldByKey = new Map<string, HeldRegistration>();
  const fanIdToPlayerId = new Map<string, string>();
  for (const reg of held) {
    heldByKey.set(regKey(reg.fanId, reg.teamName), reg);
    // A player with a registration at this club certainly exists, so this saves
    // a per-row SELECT for the common case of a returning squad.
    fanIdToPlayerId.set(reg.fanId, reg.playerId);
  }

  // ── 4. Plan players + registrations (reads only) ─────────────────────────
  const rowPlans: RowPlan[] = [];
  // Registrations an earlier row has already decided to insert. Consulting
  // these is what keeps a file that lists the same FAN and team twice from
  // counting one creation twice.
  const plannedRegIds = new Map<string, string>();

  for (const row of rows) {
    const fanId = String(row.fanId ?? "").trim();
    if (!fanId) {
      importResult.errors.push({ fanId: "(missing)", reason: "Row has no FAN ID" });
      continue;
    }

    try {
      // Resolve the player identity (no club, no registration info)
      let playerId = fanIdToPlayerId.get(fanId);
      let createPlayer = false;
      if (!playerId) {
        const existingPlayer = await db
          .prepare(`SELECT id FROM "player" WHERE fanId = ? LIMIT 1`)
          .bind(fanId)
          .first<{ id: string }>();

        if (existingPlayer) {
          playerId = existingPlayer.id;
        } else {
          playerId = randomId("player");
          createPlayer = true;
          importResult.players.created++;
        }
        fanIdToPlayerId.set(fanId, playerId);
      }

      const teamName = String(row.teamName ?? "").trim();
      const ageGroup = String(row.ageGroup ?? "").trim() || null;
      const expiry = String(row.registrationExpiry ?? "").trim() || null;
      const status = String(row.registrationStatus ?? "").trim() || null;

      const key = regKey(fanId, teamName);
      const existingRegId =
        heldByKey.get(key)?.id ?? plannedRegIds.get(key) ?? null;

      let newRegId: string | null = null;
      if (existingRegId) {
        importResult.registrations.updated++;
      } else {
        newRegId = randomId("preg");
        plannedRegIds.set(key, newRegId);
        importResult.registrations.created++;
      }

      rowPlans.push({
        fanId, playerId, createPlayer, teamName,
        ageGroup, expiry, status, existingRegId, newRegId,
      });
    } catch (err) {
      importResult.errors.push({ fanId, reason: String(err) });
    }
  }

  // ── 5. Plan users (reads only) ───────────────────────────────────────────
  // One query per 90 emails rather than one per email: a 300-row file carries
  // hundreds of addresses, and that was hundreds of sequential round trips.
  const existingUserIdByEmail = new Map<string, string>();
  const emails = [...emailRelMap.keys()];
  for (const slice of inSlices(emails)) {
    try {
      const { results } = await db
        .prepare(
          `SELECT id, email FROM "user" WHERE email IN (${slice.map(() => '?').join(',')})`,
        )
        .bind(...slice)
        .all<{ id: string; email: string }>();
      for (const row of results) existingUserIdByEmail.set(row.email, row.id);
    } catch (err) {
      for (const email of slice) importResult.errors.push({ fanId: email, reason: String(err) });
    }
  }

  const userPlans: UserPlan[] = [];
  for (const [email, fanMap] of emailRelMap) {
    const existingUserId = existingUserIdByEmail.get(email) ?? null;

    if (existingUserId) importResult.users.skipped++;
    else importResult.users.created++;

    userPlans.push({
      email,
      existingUserId,
      newUserId: randomId("user"),
      passwordFan: emailToPasswordFan.get(email) ?? "",
      fanMap,
    });
  }

  // ── 6. Work out what the file leaves behind ──────────────────────────────
  // Only teams the file actually covers can go stale. Without that guard a
  // single-team export would report every other team in the club as missing —
  // which is exactly what a chunk is, so a chunked import skips this entirely
  // and the page shows the whole-file dry run's list instead.
  const submittedTeams = new Set<string>();
  const submittedKeys = new Set<string>();
  for (const row of part ? [] : rows) {
    const fanId = String(row.fanId ?? "").trim();
    if (!fanId) continue;
    const team = normaliseTeamName(String(row.teamName ?? ""));
    submittedTeams.add(team);
    submittedKeys.add(regKey(fanId, team));
  }

  for (const reg of held) {
    const team = normaliseTeamName(reg.teamName ?? "");
    if (!submittedTeams.has(team)) continue;
    if (submittedKeys.has(regKey(reg.fanId, team))) continue;
    importResult.stale.rows.push({
      fanId: reg.fanId,
      teamName: reg.teamName,
      registrationStatus: reg.registrationStatus ?? null,
    });
  }
  importResult.stale.count = importResult.stale.rows.length;

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);

  // ── 7. Preview stops here — nothing above this line writes ───────────────
  if (dryRun) {
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: 'players import previewed',
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          rows_submitted: rows.length,
          to_create: importResult.registrations.created,
          to_update: importResult.registrations.updated,
          stale_count: importResult.stale.count,
        },
      });
    }
    return json(importResult);
  }

  // ── 8. Apply players + registrations ─────────────────────────────────────
  for (const plan of rowPlans) {
    // The counters are a forecast made while planning. A write that fails has to
    // take its own count back down, or the totals contradict the error list
    // printed beside them.
    const uncountRegistration = () => {
      if (plan.existingRegId) importResult.registrations.updated--;
      else importResult.registrations.created--;
    };

    try {
      if (plan.createPlayer) {
        await db
          .prepare(`INSERT INTO "player" (id, fanId, createdAt, updatedAt) VALUES (?, ?, ?, ?)`)
          .bind(plan.playerId, plan.fanId, nowMs(), nowMs())
          .run();
      } else {
        await db
          .prepare(`UPDATE "player" SET updatedAt = ? WHERE id = ?`)
          .bind(nowMs(), plan.playerId)
          .run();
      }
    } catch (err) {
      if (plan.createPlayer) {
        importResult.players.created--;
        // The player row was never written, so drop the mapping too: otherwise
        // the user pass links an account to a player that does not exist and
        // reports a second, spurious failure for the same row.
        fanIdToPlayerId.delete(plan.fanId);
      }
      // Its registration never gets attempted below.
      uncountRegistration();
      importResult.errors.push({ fanId: plan.fanId, reason: String(err) });
      continue;
    }

    try {
      if (plan.existingRegId) {
        await db
          .prepare(`UPDATE "player_registration" SET ageGroup = ?, registrationExpiry = ?, registrationStatus = ?, updatedAt = ? WHERE id = ?`)
          .bind(plan.ageGroup, plan.expiry, plan.status, nowMs(), plan.existingRegId)
          .run();
      } else {
        await db
          .prepare(`INSERT INTO "player_registration" (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(plan.newRegId, clubSlug, plan.playerId, plan.teamName, plan.ageGroup, plan.expiry, plan.status, nowMs(), nowMs())
          .run();
      }
    } catch (err) {
      uncountRegistration();
      importResult.errors.push({ fanId: plan.fanId, reason: String(err) });
    }
  }

  // ── 9. Apply users + user_player links ───────────────────────────────────
  for (const plan of userPlans) {
    try {
      let userId = plan.existingUserId;

      if (!userId) {
        userId = plan.newUserId;
        const hashedPassword = plan.passwordFan
          ? await hashPwd(plan.passwordFan)
          : await hashPwd(crypto.randomUUID());

        await db
          .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, clubSlug, createdAt, updatedAt) VALUES (?, '', ?, 0, 'member', ?, ?, ?)`)
          .bind(userId, plan.email, clubSlug, nowMs(), nowMs())
          .run();

        await db
          .prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`)
          .bind(randomId("acc"), plan.email, userId, hashedPassword, nowMs(), nowMs())
          .run();
      }

      // Upsert user_player links
      for (const [fanId, relationship] of plan.fanMap) {
        const playerId = fanIdToPlayerId.get(fanId);
        if (!playerId) continue;
        await db
          .prepare(`INSERT OR IGNORE INTO "user_player" (id, userId, playerId, relationship, createdAt) VALUES (?, ?, ?, ?, ?)`)
          .bind(randomId("up"), userId, playerId, relationship, nowMs())
          .run();
      }
    } catch (err) {
      importResult.errors.push({ fanId: plan.email, reason: String(err) });
    }
  }

  // ── 10. Stamp the import so the Registrations page can age the data ───────
  // Once per import, not once per chunk, and counting the whole file — otherwise
  // "last imported" reports the size of whichever slice happened to land last.
  if (isFinalPart) {
    try {
      await db
        .prepare(`INSERT INTO "club_import_log" (id, clubSlug, importedAt, rowCount, adminId) VALUES (?, ?, ?, ?, ?)`)
        .bind(randomId("imp"), clubSlug, nowMs(), part?.totalRows ?? rows.length, adminId)
        .run();
    } catch (err) {
      // A missing stamp is not worth failing an otherwise good import over.
      importResult.errors.push({ fanId: "(import log)", reason: String(err) });
    }
  }

  // One event per import, not per chunk — otherwise a 300-row file reports as
  // twelve small imports and the funnel counts are meaningless. The per-chunk
  // counts stay in the response for the client to sum.
  if (posthog && isFinalPart) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'players imported',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        rows_submitted: part?.totalRows ?? rows.length,
        chunked: part !== null,
        players_created: importResult.players.created,
        registrations_created: importResult.registrations.created,
        registrations_updated: importResult.registrations.updated,
        users_created: importResult.users.created,
        users_skipped: importResult.users.skipped,
        error_count: importResult.errors.length,
        stale_count: importResult.stale.count,
      },
    });
  }

  return json(importResult);
};
