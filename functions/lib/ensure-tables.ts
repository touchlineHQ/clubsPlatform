import { D1Database } from "@cloudflare/workers-types";

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE, "emailVerified" INTEGER NOT NULL DEFAULT 0, "image" TEXT, "role" TEXT NOT NULL DEFAULT 'member', "clubSlug" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "session" ("id" TEXT PRIMARY KEY NOT NULL, "expiresAt" INTEGER NOT NULL, "token" TEXT NOT NULL UNIQUE, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL, "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "account" ("id" TEXT PRIMARY KEY NOT NULL, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" INTEGER, "refreshTokenExpiresAt" INTEGER, "scope" TEXT, "password" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "verification" ("id" TEXT PRIMARY KEY NOT NULL, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL, "expiresAt" INTEGER NOT NULL, "createdAt" INTEGER, "updatedAt" INTEGER)`,
  `CREATE TABLE IF NOT EXISTS "club_config" ("id" TEXT PRIMARY KEY NOT NULL, "slug" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "active" INTEGER NOT NULL DEFAULT 1, "createdAt" INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "news_item" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "title" TEXT NOT NULL, "text" TEXT NOT NULL, "body" TEXT, "link" TEXT NOT NULL, "linkText" TEXT NOT NULL, "sections" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "idx_news_item_updatedAt" ON "news_item" ("updatedAt")`,
  `CREATE TABLE IF NOT EXISTS "committee_member" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "role" TEXT NOT NULL, "name" TEXT NOT NULL, "contact" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "idx_committee_member_sortOrder" ON "committee_member" ("sortOrder")`,
  `CREATE TABLE IF NOT EXISTS "team_section" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "sectionKey" TEXT NOT NULL, "name" TEXT NOT NULL, "subtitle" TEXT NOT NULL, "icon" TEXT NOT NULL, "logo" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_team_section_club_key" ON "team_section" (COALESCE("clubSlug",''), "sectionKey")`,
  `CREATE INDEX IF NOT EXISTS "idx_team_section_sortOrder" ON "team_section" ("sortOrder")`,
  `CREATE TABLE IF NOT EXISTS "team" ("id" TEXT PRIMARY KEY NOT NULL, "sectionId" TEXT NOT NULL REFERENCES "team_section"("id") ON DELETE CASCADE, "name" TEXT NOT NULL, "description" TEXT NOT NULL, "manager" TEXT NOT NULL, "coach" TEXT NOT NULL, "contact" TEXT NOT NULL, "photo" TEXT, "slug" TEXT, "sidebar" INTEGER NOT NULL DEFAULT 0, "managerLabel" TEXT, "coachLabel" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "idx_team_sectionId_sortOrder" ON "team" ("sectionId", "sortOrder")`,
  `CREATE TABLE IF NOT EXISTS "pitch" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "name" TEXT NOT NULL, "formats" TEXT NOT NULL, "description" TEXT, "active" INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS "booking_request" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "teamName" TEXT NOT NULL, "teamSlug" TEXT, "teamLeague" TEXT, "date" TEXT NOT NULL, "timeStart" TEXT NOT NULL, "timeEnd" TEXT NOT NULL, "format" TEXT NOT NULL, "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'pending', "declineReason" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_request_userId" ON "booking_request" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_request_date" ON "booking_request" ("date")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_request_status" ON "booking_request" ("status")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_request_teamSlug" ON "booking_request" ("teamSlug", "teamLeague")`,
  `CREATE TABLE IF NOT EXISTS "booking" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "requestId" TEXT REFERENCES "booking_request"("id") ON DELETE SET NULL, "pitchId" TEXT NOT NULL REFERENCES "pitch"("id"), "date" TEXT NOT NULL, "timeStart" TEXT NOT NULL, "timeEnd" TEXT NOT NULL, "teamName" TEXT NOT NULL, "teamSlug" TEXT, "teamLeague" TEXT, "format" TEXT NOT NULL, "notes" TEXT, "createdAt" INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_pitchId_date" ON "booking" ("pitchId", "date")`,
  `CREATE INDEX IF NOT EXISTS "idx_booking_date" ON "booking" ("date")`,
  `CREATE TABLE IF NOT EXISTS "user_team_role" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "teamSlug" TEXT NOT NULL, "teamLeague" TEXT NOT NULL, "teamName" TEXT NOT NULL, "role" TEXT NOT NULL CHECK("role" IN ('coach', 'manager', 'subscriber')), "createdAt" INTEGER NOT NULL, UNIQUE("userId", "teamSlug", "teamLeague"))`,
  `CREATE INDEX IF NOT EXISTS "idx_user_team_role_userId" ON "user_team_role" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "idx_user_team_role_teamSlug" ON "user_team_role" ("teamSlug", "teamLeague")`,
];

const PITCH_SEED_STATEMENTS = [
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_1', 'Pitch 1', '["11v11"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_2', 'Pitch 2', '["11v11","9v9"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_3', 'Pitch 3', '["11v11","9v9"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_4', 'Pitch 4', '["11v11","7v7"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_5', 'Pitch 5', '["9v9","7v7"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_6', 'Pitch 6', '["7v7"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_7', 'Pitch 7', '["5v5"]', 1)`,
  `INSERT OR IGNORE INTO "pitch" ("id", "name", "formats", "active") VALUES ('pitch_8', 'Pitch 8', '["5v5"]', 1)`,
];

const ALL_SQL = [...TABLE_STATEMENTS, ...PITCH_SEED_STATEMENTS].join(';\n');

let ensureTablesPromise: Promise<void> | null = null;

export const ensureTables = (db: D1Database): Promise<void> => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = db.exec(ALL_SQL)
      .then(() => undefined)
      .catch((err) => {
        ensureTablesPromise = null;
        throw err;
      });
  }
  return ensureTablesPromise;
};
