-- Player enquiries (#73).
--
-- A lead from the public "join the club" form, not a player record. Contact
-- fields are nulled when the enquiry reaches registered / declined, and by the
-- stale purge after 6 months untouched; age group, dates and outcome stay for
-- funnel stats. No free-text field on purpose (see the issue).
CREATE TABLE IF NOT EXISTS "player_enquiry" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT NOT NULL, "ageGroup" TEXT NOT NULL, "team" TEXT, "enquirerType" TEXT NOT NULL CHECK("enquirerType" IN ('guardian', 'player')), "contactName" TEXT, "contactEmail" TEXT, "contactPhone" TEXT, "playerFirstName" TEXT, "status" TEXT NOT NULL DEFAULT 'new' CHECK("status" IN ('new', 'contacted', 'fa_sent', 'registered', 'declined')), "consentAt" INTEGER NOT NULL, "contactPurgedAt" INTEGER, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS "idx_player_enquiry_club_created" ON "player_enquiry" ("clubSlug", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_player_enquiry_stale" ON "player_enquiry" ("contactPurgedAt", "updatedAt");
-- Per-IP submission counter for the public form. The key is a salted hash of
-- the IP plus the hour bucket, so no raw IP is stored.
CREATE TABLE IF NOT EXISTS "enquiry_rate_limit" ("key" TEXT PRIMARY KEY NOT NULL, "count" INTEGER NOT NULL, "windowStart" INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS "idx_enquiry_rate_limit_window" ON "enquiry_rate_limit" ("windowStart");
