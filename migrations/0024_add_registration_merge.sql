-- Merge registrations: one payment covering many registrations.
--
-- A U15 playing two days is one set of subs; a U18 who also plays for Robins
-- First may be two. Age group does not tell them apart, so an admin decides.
--
-- Only SECONDARY registrations get a row, so the default needs no backfill and
-- import-players.ts (which never writes here) cannot undo an admin's decision.

-- PK is registrationId alone: a composite with clubSlug would let two clubs
-- claim one registration.
--
-- primaryRegistrationId is RESTRICT, registrationId CASCADE: a primary vanishing
-- would cascade away the group's only payment rows and dissolve it silently.
CREATE TABLE IF NOT EXISTS "registration_merge" (
  "clubSlug" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL PRIMARY KEY REFERENCES "player_registration"("id") ON DELETE CASCADE,
  "primaryRegistrationId" TEXT NOT NULL REFERENCES "player_registration"("id") ON DELETE RESTRICT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  CHECK ("registrationId" <> "primaryRegistrationId")
);
CREATE INDEX IF NOT EXISTS "idx_registration_merge_primary" ON "registration_merge" ("primaryRegistrationId");
CREATE INDEX IF NOT EXISTS "idx_registration_merge_clubSlug" ON "registration_merge" ("clubSlug");
