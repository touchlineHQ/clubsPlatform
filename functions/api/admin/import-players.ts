import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { hashSeededPwd } from "../../lib/auth";
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
  /** Server-generated identifier shared by every part of a chunked import. */
  runId?: string;
  /** Player identity rows inserted. A returning player counts in neither field. */
  players: { created: number };
  registrations: { created: number; updated: number };
  users: { created: number; skipped: number };
  errors: { fanId: string; reason: string }[];
  stale: { count: number; rows: StaleRegistration[] };
}

export const IMPORT_LIMITS = {
  maxRows: 5000,
  /**
   * Rows one write request may carry.
   *
   * A row costs about nine D1 round trips and Cloudflare counts each one as a
   * subrequest, so a whole club in a single request is roughly 13,700 against a
   * 10,000 limit. The client batches to this; the server refuses more so an
   * out-of-date page fails with a message instead of a killed Worker. A dry run
   * is exempt: it writes nothing, and only a whole-file pass can find stale
   * registrations.
   */
  maxCommitRows: 25,
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
 * A whole-club import in one request exhausts the Worker's per-request budget
 * and leaves the club half-imported, so the client sends slices. Seeding the
 * accounts was the bulk of it until lazy hashing (SEEDED_ROUNDS in lib/auth.ts);
 * what remains is the D1 round trips, which are subrequests.
 *
 * Absent means an unchunked import, which maxCommitRows keeps small.
 */
interface ImportPart {
  index: number;
  total: number;
  /** Returned by the server for part zero, then required for every later part. */
  runId?: string;
}

/**
 * Check a supplied import part before any player import writes.
 * Missing parts are valid for unchunked requests; present parts need a zero-based
 * index below a positive total; the first part forbids a run ID, and later
 * parts require a nonempty run ID of at most 200 characters.
 * Returns an error message for invalid parts, or null otherwise.
 */
function validatePart(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return 'part must be an object';
  const p = v as Record<string, unknown>;
  for (const k of ['index', 'total'] as const) {
    if (!Number.isInteger(p[k]) || (p[k] as number) < 0) return `part.${k} must be a non-negative integer`;
  }
  if ((p.index as number) >= (p.total as number)) return 'part.index must be less than part.total';
  if (p.index === 0 && p.runId !== undefined) return 'part.runId must be omitted for the first part';
  if (p.index !== 0 && (typeof p.runId !== 'string' || !p.runId || p.runId.length > 200)) {
    return 'part.runId is required after the first part';
  }
  return null;
}

interface ImportRunTotals {
  partCount: number;
  rowCount: number;
  playersCreated: number;
  registrationsCreated: number;
  registrationsUpdated: number;
  usersCreated: number;
  usersSkipped: number;
  errorCount: number;
}

/**
 * D1 caps a query at 100 bound parameters, so an `IN (…)` list over a whole
 * club's worth of values has to be issued in slices.
 */
const MAX_BOUND_PARAMS = 90;

/** Split values into ordered groups of at most 90 for bound-parameter queries. */
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

/**
 * Preview or commit player rows for the authenticated club administrator.
 * A whole-file dry run reports projected counts and stale registrations
 * without writing players; an unchunked write also reports staleness. Chunked
 * writes return no stale registrations because each part covers only a slice.
 * They require sequential parts under the server-issued run ID, return
 * per-part counts with that ID, and attempt the full-import log stamp only
 * on the final part.
 * Row-level write failures appear in the response's errors; invalid input
 * returns 400, and conflicting or incomplete parts return 409. Database and
 * analytics failures outside the per-row handlers can still reject the request.
 */
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
    if (body.dryRun !== true && body.rows.length > IMPORT_LIMITS.maxCommitRows) {
      return json(
        {
          error: `This page is out of date: it sent all ${body.rows.length} rows at once `
            + `instead of in batches of ${IMPORT_LIMITS.maxCommitRows}. Reload and import again.`,
        },
        { status: 400 },
      );
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

  const db = context.env.DB;
  const adminId = (result.session.user as Record<string, unknown>).id as string;
  let importRunId: string | null = null;
  /** When this run began; accounts at least this old are an earlier part's. */
  let runStartedAt: number | null = null;

  // Claim the part before doing any import work. A later part can advance only
  // after every preceding claim has produced its immutable part record.
  if (!dryRun && part) {
    if (part.index === 0) {
      importRunId = randomId("imprun");
      runStartedAt = nowMs();
      await db
        .prepare(`INSERT INTO "player_import_run" (id, clubSlug, adminId, totalParts, nextPart, createdAt) VALUES (?, ?, ?, ?, 1, ?)`)
        .bind(importRunId, clubSlug, adminId, part.total, runStartedAt)
        .run();
    } else {
      importRunId = part.runId!;
      const claim = await db
        .prepare(
          `UPDATE "player_import_run"
              SET nextPart = nextPart + 1
            WHERE id = ? AND clubSlug = ? AND adminId = ? AND totalParts = ?
              AND nextPart = ? AND completedAt IS NULL
              AND (SELECT COUNT(*) FROM "player_import_run_part" WHERE runId = ?) = ?`,
        )
        .bind(importRunId, clubSlug, adminId, part.total, part.index, importRunId, part.index)
        .run();
      if (claim.meta.changes !== 1) {
        return json(
          { error: "Import part does not belong to this run or arrived out of sequence" },
          { status: 409 },
        );
      }
      const run = await db
        .prepare(`SELECT createdAt FROM "player_import_run" WHERE id = ? AND clubSlug = ?`)
        .bind(importRunId, clubSlug)
        .first<{ createdAt: number }>();
      runStartedAt = run?.createdAt ?? null;
    }
  }

  /** The slice that stamps the import and reports the run to analytics. */
  const isFinalPart = !part || part.index === part.total - 1;
  const importResult: ImportResult = {
    ok: true,
    players: { created: 0 },
    registrations: { created: 0, updated: 0 },
    users: { created: 0, skipped: 0 },
    errors: [],
    stale: { count: 0, rows: [] },
  };
  if (importRunId) importResult.runId = importRunId;

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
  const existingUserByEmail = new Map<string, { id: string; createdAt: number }>();
  const emails = [...emailRelMap.keys()];
  for (const slice of inSlices(emails)) {
    try {
      const { results } = await db
        .prepare(
          `SELECT id, email, createdAt FROM "user" WHERE email IN (${slice.map(() => '?').join(',')})`,
        )
        .bind(...slice)
        .all<{ id: string; email: string; createdAt: number }>();
      for (const row of results) {
        existingUserByEmail.set(row.email, { id: row.id, createdAt: row.createdAt });
      }
    } catch (err) {
      for (const email of slice) importResult.errors.push({ fanId: email, reason: String(err) });
    }
  }

  const userPlans: UserPlan[] = [];
  for (const [email, fanMap] of emailRelMap) {
    const existing = existingUserByEmail.get(email) ?? null;
    const existingUserId = existing?.id ?? null;

    // An account an earlier part of this run created counts as neither: the
    // client sums the parts, so calling it "already existed" here would report
    // one parent of two children as both created and pre-existing.
    const madeByThisRun =
      existing !== null && runStartedAt !== null && existing.createdAt >= runStartedAt;

    if (!existing) importResult.users.created++;
    else if (!madeByThisRun) importResult.users.skipped++;

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
        // Seeded, not full strength: see SEEDED_ROUNDS in lib/auth.ts. The
        // member's first sign-in re-hashes it properly.
        const hashedPassword = plan.passwordFan
          ? await hashSeededPwd(plan.passwordFan)
          : await hashSeededPwd(crypto.randomUUID());

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
  let runTotals: ImportRunTotals | null = null;
  if (part && importRunId) {
    await db
      .prepare(
        `INSERT INTO "player_import_run_part"
           (runId, partIndex, rowCount, playersCreated, registrationsCreated,
            registrationsUpdated, usersCreated, usersSkipped, errorCount, recordedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        importRunId,
        part.index,
        rows.length,
        importResult.players.created,
        importResult.registrations.created,
        importResult.registrations.updated,
        importResult.users.created,
        importResult.users.skipped,
        importResult.errors.length,
        nowMs(),
      )
      .run();

    if (isFinalPart) {
      runTotals = await db
        .prepare(
          `SELECT COUNT(*) AS partCount,
                  COALESCE(SUM(rowCount), 0) AS rowCount,
                  COALESCE(SUM(playersCreated), 0) AS playersCreated,
                  COALESCE(SUM(registrationsCreated), 0) AS registrationsCreated,
                  COALESCE(SUM(registrationsUpdated), 0) AS registrationsUpdated,
                  COALESCE(SUM(usersCreated), 0) AS usersCreated,
                  COALESCE(SUM(usersSkipped), 0) AS usersSkipped,
                  COALESCE(SUM(errorCount), 0) AS errorCount
             FROM "player_import_run_part" WHERE runId = ?`,
        )
        .bind(importRunId)
        .first<ImportRunTotals>();

      if (!runTotals || runTotals.partCount !== part.total) {
        return json({ error: "Cannot finalize an import before every part is recorded" }, { status: 409 });
      }

      const finalized = await db
        .prepare(
          `UPDATE "player_import_run" SET completedAt = ?
            WHERE id = ? AND clubSlug = ? AND adminId = ? AND totalParts = ?
              AND nextPart = totalParts AND completedAt IS NULL`,
        )
        .bind(nowMs(), importRunId, clubSlug, adminId, part.total)
        .run();
      if (finalized.meta.changes !== 1) {
        return json({ error: "Import run could not be finalized" }, { status: 409 });
      }
    }
  }

  // Once per import, not once per chunk. Chunked row counts come only from the
  // part records above, never from a client-claimed whole-file total.
  if (isFinalPart) {
    try {
      await db
        .prepare(`INSERT INTO "club_import_log" (id, clubSlug, importedAt, rowCount, adminId) VALUES (?, ?, ?, ?, ?)`)
        .bind(randomId("imp"), clubSlug, nowMs(), runTotals?.rowCount ?? rows.length, adminId)
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
        rows_submitted: runTotals?.rowCount ?? rows.length,
        chunked: part !== null,
        players_created: runTotals?.playersCreated ?? importResult.players.created,
        registrations_created: runTotals?.registrationsCreated ?? importResult.registrations.created,
        registrations_updated: runTotals?.registrationsUpdated ?? importResult.registrations.updated,
        users_created: runTotals?.usersCreated ?? importResult.users.created,
        users_skipped: runTotals?.usersSkipped ?? importResult.users.skipped,
        error_count: runTotals?.errorCount ?? importResult.errors.length,
        stale_count: importResult.stale.count,
      },
    });
  }

  return json(importResult);
};
