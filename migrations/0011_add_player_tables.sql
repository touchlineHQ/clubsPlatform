-- Permanent player identity keyed by FA Number (globally unique)
CREATE TABLE IF NOT EXISTS "player" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "fanId" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

-- Yearly/per-club/per-team registration (separate from identity)
CREATE TABLE IF NOT EXISTS "player_registration" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "playerId" TEXT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "teamSlug" TEXT NOT NULL,
  "teamName" TEXT NOT NULL,
  "ageGroup" TEXT,
  "registrationExpiry" TEXT,
  "registrationStatus" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE("clubSlug", "playerId", "teamSlug")
);
CREATE INDEX IF NOT EXISTS "idx_player_registration_clubSlug" ON "player_registration" ("clubSlug");
CREATE INDEX IF NOT EXISTS "idx_player_registration_playerId" ON "player_registration" ("playerId");

-- Club-agnostic link between a user account and a player
CREATE TABLE IF NOT EXISTS "user_player" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "playerId" TEXT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "relationship" TEXT NOT NULL CHECK("relationship" IN ('self', 'guardian')),
  "createdAt" INTEGER NOT NULL,
  UNIQUE("userId", "playerId")
);
CREATE INDEX IF NOT EXISTS "idx_user_player_userId" ON "user_player" ("userId");
CREATE INDEX IF NOT EXISTS "idx_user_player_playerId" ON "user_player" ("playerId");

-- Mark auto-imported teams as needing consolidation with fixture-linked teams
ALTER TABLE "team" ADD COLUMN "forConsolidation" INTEGER NOT NULL DEFAULT 0;
