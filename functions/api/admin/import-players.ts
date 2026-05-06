import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { hashPwd } from "../../lib/auth";
import { ensureTables } from "../../lib/ensure-tables";

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
  teams: { stubsCreated: number };
  errors: { fanId: string; reason: string }[];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
    rows = body.rows as ParsedPlayerRow[];
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const importResult: ImportResult = {
    ok: true,
    players: { created: 0, updated: 0 },
    users: { created: 0, skipped: 0 },
    teams: { stubsCreated: 0 },
    errors: [],
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

  // ── 3. Resolve / create teams ─────────────────────────────────────────────
  const uniqueTeamNames = [...new Set(rows.map(r => String(r.teamName ?? "").trim()).filter(Boolean))];
  const teamSlugToId = new Map<string, string>();

  for (const teamName of uniqueTeamNames) {
    const teamSlug = slugify(teamName);

    // Check existing team by slug under any section of this club
    const existing = await context.env.DB
      .prepare(`
        SELECT t.id FROM "team" t
        JOIN "team_section" ts ON ts.id = t.sectionId
        WHERE t.slug = ? AND (ts.clubSlug = ? OR (? IS NULL AND ts.clubSlug IS NULL))
        LIMIT 1
      `)
      .bind(teamSlug, clubSlug, clubSlug)
      .first<{ id: string }>();

    if (existing) {
      teamSlugToId.set(teamSlug, existing.id);
      continue;
    }

    // Find-or-create the 'imported' team_section
    let section = await context.env.DB
      .prepare(`SELECT id FROM "team_section" WHERE sectionKey = 'imported' AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL)) LIMIT 1`)
      .bind(clubSlug, clubSlug)
      .first<{ id: string }>();

    if (!section) {
      const sectionId = randomId("ts");
      await context.env.DB
        .prepare(`INSERT INTO "team_section" (id, clubSlug, sectionKey, name, subtitle, icon, sortOrder, createdAt, updatedAt) VALUES (?, ?, 'imported', 'Imported Teams', '', 'fa-upload', 999, ?, ?)`)
        .bind(sectionId, clubSlug, nowMs(), nowMs())
        .run();
      section = { id: sectionId };
    }

    // Create stub team with forConsolidation = 1
    const teamId = randomId("team");
    await context.env.DB
      .prepare(`INSERT INTO "team" (id, sectionId, name, description, manager, coach, contact, slug, forConsolidation, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, '', '', '', '', ?, 1, 0, ?, ?)`)
      .bind(teamId, section.id, teamName, teamSlug, nowMs(), nowMs())
      .run();

    teamSlugToId.set(teamSlug, teamId);
    importResult.teams.stubsCreated++;
  }

  // ── 4. Upsert players + registrations ────────────────────────────────────
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
      const teamSlug = slugify(teamName);
      const ageGroup = String(row.ageGroup ?? "").trim() || null;
      const expiry = String(row.registrationExpiry ?? "").trim() || null;
      const status = String(row.registrationStatus ?? "").trim() || null;

      const existingReg = await context.env.DB
        .prepare(`SELECT id FROM "player_registration" WHERE clubSlug = ? AND playerId = ? AND teamSlug = ? LIMIT 1`)
        .bind(clubSlug, playerId, teamSlug)
        .first<{ id: string }>();

      if (existingReg) {
        await context.env.DB
          .prepare(`UPDATE "player_registration" SET teamName = ?, ageGroup = ?, registrationExpiry = ?, registrationStatus = ?, updatedAt = ? WHERE id = ?`)
          .bind(teamName, ageGroup, expiry, status, nowMs(), existingReg.id)
          .run();
        importResult.players.updated++;
      } else {
        await context.env.DB
          .prepare(`INSERT INTO "player_registration" (id, clubSlug, playerId, teamSlug, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(randomId("preg"), clubSlug, playerId, teamSlug, teamName, ageGroup, expiry, status, nowMs(), nowMs())
          .run();
      }
    } catch (err) {
      importResult.errors.push({ fanId, reason: String(err) });
    }
  }

  // ── 5. Upsert users + user_player links ──────────────────────────────────
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
        const passwordFan = emailToPasswordFan.get(email) ?? "";
        const hashedPassword = passwordFan ? await hashPwd(passwordFan) : await hashPwd(crypto.randomUUID());

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

  return json(importResult);
};
