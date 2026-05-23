-- Per-registration subscription level overrides. Highest-priority tier above
-- team_status_subscription_level → status_subscription_level →
-- team_subscription_level. Lets two players on the same team be charged
-- different rates while still drawing from the existing subscription_level
-- catalogue.

CREATE TABLE IF NOT EXISTS "registration_subscription_level" (
  "clubSlug" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL PRIMARY KEY
    REFERENCES "player_registration"("id") ON DELETE CASCADE,
  "subscriptionLevelId" TEXT NOT NULL
    REFERENCES "subscription_level"("id") ON DELETE CASCADE,
  "updatedAt" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_registration_subscription_level_levelId"
  ON "registration_subscription_level" ("subscriptionLevelId");
