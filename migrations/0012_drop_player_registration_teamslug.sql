-- Recreate player_registration without teamSlug using table swap.
-- Safe regardless of whether teamSlug column currently exists:
-- the INSERT only selects columns present in the new schema.
CREATE TABLE "player_registration_new" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "playerId" TEXT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "teamName" TEXT NOT NULL,
  "ageGroup" TEXT,
  "registrationExpiry" TEXT,
  "registrationStatus" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE("clubSlug", "playerId", "teamName")
);
INSERT INTO "player_registration_new"
  SELECT id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt
  FROM "player_registration";
DROP TABLE "player_registration";
ALTER TABLE "player_registration_new" RENAME TO "player_registration";
CREATE INDEX IF NOT EXISTS "idx_player_registration_clubSlug" ON "player_registration" ("clubSlug");
CREATE INDEX IF NOT EXISTS "idx_player_registration_playerId" ON "player_registration" ("playerId");
