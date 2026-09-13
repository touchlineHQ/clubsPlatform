import { invitationMessage } from "../../lib/account-email";
import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs, isMultiClubMode } from "../../lib/api-helpers";
import { hashPwd } from "../../lib/auth";
import { clubLink, getClubIdentity } from "../../lib/club-identity";
import { getMailer } from "../../lib/email";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { SET_PASSWORD_TOKEN_TTL_MS, createSetPasswordToken } from "../../lib/set-password-token";

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
  users: { created: number; skipped: number };
  /**
   * What happened to the set-password invitations. `configured` is false when
   * no mail provider is set up, which is the difference between "nobody needed
   * inviting" and "nothing went out and nobody knows their account exists".
   */
  invitations: { configured: boolean; sent: number; failed: number };
  errors: { fanId: string; reason: string }[];
}

/** How many invitations are in flight at once. */
const INVITE_BATCH_SIZE = 10;

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
    users: { created: 0, skipped: 0 },
    invitations: { configured: false, sent: 0, failed: 0 },
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

  // ── 2. Upsert players + registrations ────────────────────────────────────
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

  // ── 3. Upsert users + user_player links ──────────────────────────────────
  // Accounts created here are invited afterwards, in one batched pass.
  const invitees: { email: string; userId: string }[] = [];

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
        // An unguessable placeholder nobody is expected to know or use. This
        // used to be the player's FAN ID, which is printed on team sheets and
        // known to every coach in the age group — a guessable password on an
        // account its owner had never been told about. The invitation below is
        // how the account is actually reached.
        const hashedPassword = await hashPwd(`${crypto.randomUUID()}${crypto.randomUUID()}`);

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
        invitees.push({ email, userId });
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

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);

  // ── 4. Invite the accounts just created ──────────────────────────────────
  // A provider failure here is recorded and reported back, never raised: the
  // players and registrations are already written, and losing that work
  // because a mail relay was down would be the worse outcome by far.
  const mailer = getMailer(context.env);
  importResult.invitations.configured = mailer !== null;

  if (mailer && invitees.length > 0) {
    const identity = await getClubIdentity(context.env.DB, clubSlug);
    const clubName = identity?.name ?? "Your club";
    const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
    const multiClub = isMultiClubMode(context.env);
    const expiryDays = Math.round(SET_PASSWORD_TOKEN_TTL_MS / (24 * 60 * 60 * 1000));

    // Batched rather than one big Promise.all: an import can create hundreds of
    // accounts, and firing that many outbound requests at once is how a worker
    // hits its subrequest ceiling mid-import.
    for (let i = 0; i < invitees.length; i += INVITE_BATCH_SIZE) {
      const batch = invitees.slice(i, i + INVITE_BATCH_SIZE);
      const outcomes = await Promise.allSettled(
        batch.map(async ({ email, userId }) => {
          const token = await createSetPasswordToken(context.env.DB, userId);
          const link = clubLink(
            baseURL,
            clubSlug,
            `/reset-password?token=${encodeURIComponent(token)}`,
            multiClub,
          );
          const message = invitationMessage(clubName, link, expiryDays);
          await mailer.send({
            to: email,
            subject: message.subject,
            html: message.html,
            text: message.text,
            fromName: clubName,
            ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}),
          });
        }),
      );

      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") {
          importResult.invitations.sent++;
        } else {
          importResult.invitations.failed++;
        }
      }
    }

    if (importResult.invitations.failed > 0 && posthog) {
      await posthog.captureExceptionImmediate(
        new Error(`${importResult.invitations.failed} import invitation(s) could not be sent`),
        adminId,
        { source: "import-players-invite", club_slug: clubSlug },
      );
    }
  }

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
        invitations_sent: importResult.invitations.sent,
        invitations_failed: importResult.invitations.failed,
        mail_configured: importResult.invitations.configured,
        error_count: importResult.errors.length,
      },
    });
  }

  return json(importResult);
};
