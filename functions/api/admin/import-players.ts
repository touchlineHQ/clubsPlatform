import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { hashPwd } from "../../lib/auth";
import { reportEmailFailure, sendImportWelcome } from "../../lib/account-email";
import { createSetPasswordToken } from "../../lib/set-password-token";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog, clubGroups } from "../../lib/posthog";

export interface ParsedPlayerRow {
  fanId: string;
  ageGroup: string;
  teamName: string;
  registrationExpiry: string;
  registrationStatus: string;
  playerEmail: string;   // may be empty
  parentEmails: string[]; // split and trimmed
}

interface ImportResult {
  ok: boolean;
  players: { created: number; updated: number };
  /**
   * `invited` and `inviteFailed` count set-password emails, not accounts. They
   * are reported separately because an import can succeed completely while
   * every invitation bounces, and the admin needs to be able to tell.
   */
  users: { created: number; skipped: number; invited: number; inviteFailed: number };
  errors: { fanId: string; reason: string }[];
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Club slug required" }, { status: 400 });

  await ensureTables(context.env.DB);

  let rows: ParsedPlayerRow[];
  try {
    const body = await context.request.json() as { rows?: unknown };
    if (!Array.isArray(body.rows)) {
      return json({ error: "Expected { rows: [] }" }, { status: 400 });
    }
    if (body.rows.length > IMPORT_LIMITS.maxRows) {
      return json(
        { error: `Too many rows (max ${IMPORT_LIMITS.maxRows})` },
        { status: 400 },
      );
    }
    for (let i = 0; i < body.rows.length; i++) {
      const err = validateImportRow(body.rows[i]);
      if (err) {
        return json({ error: `Row ${i}: ${err}` }, { status: 400 });
      }
    }
    rows = body.rows as ParsedPlayerRow[];
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const importResult: ImportResult = {
    ok: true,
    players: { created: 0, updated: 0 },
    users: { created: 0, skipped: 0, invited: 0, inviteFailed: 0 },
    errors: [],
  };

  // ── 1. Pre-process: build email→player maps ──────────────────────────────
  // email → Map<fanId, relationship>
  const emailRelMap = new Map<string, Map<string, "self" | "guardian">>();

  for (const row of rows) {
    const fanId = String(row.fanId ?? "").trim();
    if (!fanId) continue;

    const playerEmail = String(row.playerEmail ?? "").trim().toLowerCase();
    if (playerEmail) {
      if (!emailRelMap.has(playerEmail)) emailRelMap.set(playerEmail, new Map());
      emailRelMap.get(playerEmail)!.set(fanId, "self");
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

  // ── 2. Accounts created below, invited once the import has finished ──────
  const newUserEmails: { userId: string; email: string }[] = [];

  // ── 3. Upsert players + registrations ────────────────────────────────────
  const fanIdToPlayerId = new Map<string, string>();

  for (const row of rows) {
    const fanId = String(row.fanId ?? "").trim();
    if (!fanId) {
      importResult.errors.push({ fanId: "(missing)", reason: "Row has no FAN ID" });
      continue;
    }

    try {
      // Upsert player (identity — no club, no registration info)
      const existingPlayer = await context.env.DB
        .prepare(`SELECT id FROM "player" WHERE fanId = ? LIMIT 1`)
        .bind(fanId)
        .first<{ id: string }>();

      let playerId: string;
      if (existingPlayer) {
        playerId = existingPlayer.id;
        await context.env.DB
          .prepare(`UPDATE "player" SET updatedAt = ? WHERE id = ?`)
          .bind(nowMs(), playerId)
          .run();
      } else {
        playerId = randomId("player");
        await context.env.DB
          .prepare(`INSERT INTO "player" (id, fanId, createdAt, updatedAt) VALUES (?, ?, ?, ?)`)
          .bind(playerId, fanId, nowMs(), nowMs())
          .run();
        importResult.players.created++;
      }
      fanIdToPlayerId.set(fanId, playerId);

      // Upsert player_registration
      const teamName = String(row.teamName ?? "").trim();
      const ageGroup = String(row.ageGroup ?? "").trim() || null;
      const expiry = String(row.registrationExpiry ?? "").trim() || null;
      const status = String(row.registrationStatus ?? "").trim() || null;

      const existingReg = await context.env.DB
        .prepare(`SELECT id FROM "player_registration" WHERE clubSlug = ? AND playerId = ? AND teamName = ? LIMIT 1`)
        .bind(clubSlug, playerId, teamName)
        .first<{ id: string }>();

      if (existingReg) {
        await context.env.DB
          .prepare(`UPDATE "player_registration" SET ageGroup = ?, registrationExpiry = ?, registrationStatus = ?, updatedAt = ? WHERE id = ?`)
          .bind(ageGroup, expiry, status, nowMs(), existingReg.id)
          .run();
        importResult.players.updated++;
      } else {
        await context.env.DB
          .prepare(`INSERT INTO "player_registration" (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(randomId("preg"), clubSlug, playerId, teamName, ageGroup, expiry, status, nowMs(), nowMs())
          .run();
      }
    } catch (err) {
      importResult.errors.push({ fanId, reason: String(err) });
    }
  }

  // ── 4. Upsert users + user_player links ──────────────────────────────────
  for (const [email, fanMap] of emailRelMap) {
    try {
      // Find or create user
      let userRow = await context.env.DB
        .prepare(`SELECT id FROM "user" WHERE email = ? LIMIT 1`)
        .bind(email)
        .first<{ id: string }>();

      if (userRow) {
        importResult.users.skipped++;
      } else {
        const userId = randomId("user");
        // The placeholder password is unguessable and is never told to anyone.
        // It used to be the player's FAN ID — printed on team sheets and known
        // to every coach in the age group — and nobody was told about that
        // either, so it was a weak credential that unlocked an account its owner
        // did not know existed. The account is now reached through the
        // invitation below, or through a password reset.
        const hashedPassword = await hashPwd(crypto.randomUUID());

        await context.env.DB
          .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, clubSlug, createdAt, updatedAt) VALUES (?, '', ?, 0, 'member', ?, ?, ?)`)
          .bind(userId, email, clubSlug, nowMs(), nowMs())
          .run();

        await context.env.DB
          .prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`)
          .bind(randomId("acc"), email, userId, hashedPassword, nowMs(), nowMs())
          .run();

        userRow = { id: userId };
        importResult.users.created++;
        newUserEmails.push({ userId, email });
      }

      // Upsert user_player links
      for (const [fanId, relationship] of fanMap) {
        const playerId = fanIdToPlayerId.get(fanId);
        if (!playerId) continue;
        await context.env.DB
          .prepare(`INSERT OR IGNORE INTO "user_player" (id, userId, playerId, relationship, createdAt) VALUES (?, ?, ?, ?, ?)`)
          .bind(randomId("up"), userRow.id, playerId, relationship, nowMs())
          .run();
      }
    } catch (err) {
      importResult.errors.push({ fanId: email, reason: String(err) });
    }
  }

  // ── 5. Invite the accounts we just created ───────────────────────────────
  // Sent after every row has been written, so a provider that hangs cannot
  // leave the import half-applied. Each send is isolated: a bad address, a
  // rate limit or an outage costs that one invitation and nothing else, which
  // is why this loop never adds to `errors` — the account exists and works,
  // and its owner can still get in through "Forgot your password?".
  const origin = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  for (const { userId, email } of newUserEmails) {
    try {
      const token = await createSetPasswordToken(context.env.DB, userId);
      const sent = await sendImportWelcome(context.env, { origin, clubSlug, email, token });
      if (sent) importResult.users.invited++;
    } catch (err) {
      importResult.users.inviteFailed++;
      await reportEmailFailure(context.env, err, { kind: "import-welcome", userId, clubSlug });
    }
  }

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'players imported',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        rows_submitted: rows.length,
        players_created: importResult.players.created,
        players_updated: importResult.players.updated,
        users_created: importResult.users.created,
        users_skipped: importResult.users.skipped,
        users_invited: importResult.users.invited,
        invites_failed: importResult.users.inviteFailed,
        error_count: importResult.errors.length,
      },
    });
  }

  return json(importResult);
};
