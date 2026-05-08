-- Treasurer-defined subscription levels (e.g. "5 aside", "7 aside") with
-- a yearly price that can be split into a number of equal payments via
-- GoCardless.

CREATE TABLE IF NOT EXISTS "subscription_level" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "yearlyPriceInPence" INTEGER NOT NULL,
  "intervalCount" INTEGER NOT NULL DEFAULT 1,
  "intervalUnit" TEXT NOT NULL DEFAULT 'yearly'
    CHECK ("intervalUnit" IN ('weekly', 'monthly', 'yearly')),
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clubSlug", "name")
);

CREATE INDEX IF NOT EXISTS "idx_subscription_level_clubSlug"
  ON "subscription_level" ("clubSlug");

-- A team (identified by player_registration.teamName for a club) can be
-- assigned a single subscription level. Players inherit the level from
-- their team registration.
CREATE TABLE IF NOT EXISTS "team_subscription_level" (
  "clubSlug" TEXT NOT NULL,
  "teamName" TEXT NOT NULL,
  "subscriptionLevelId" TEXT NOT NULL
    REFERENCES "subscription_level"("id") ON DELETE CASCADE,
  "updatedAt" INTEGER NOT NULL,
  PRIMARY KEY ("clubSlug", "teamName")
);

CREATE INDEX IF NOT EXISTS "idx_team_subscription_level_levelId"
  ON "team_subscription_level" ("subscriptionLevelId");
