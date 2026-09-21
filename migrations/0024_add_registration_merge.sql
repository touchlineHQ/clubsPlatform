-- Merge registrations: one payment covering many registrations.
--
-- A player can hold several registrations at one club (player_registration is
-- UNIQUE(clubSlug, playerId, teamName), one row per team), but not every one of
-- them is a separate thing to charge for. A U15 playing Tuesdays and Thursdays
-- is two registrations and one set of subs; a U18 who also plays for Robins
-- First may genuinely be two. Nothing in the data distinguishes the two cases —
-- age group does not, which is why this is an explicit admin action rather than
-- an inferred flag.
--
-- Only SECONDARY registrations get a row here. A registration with no row of its
-- own is a primary, which for an unmerged registration is the trivial group of
-- one. That way the default state needs no backfill, and re-importing players
-- cannot disturb an admin's decision — api/admin/import-players.ts never writes
-- this table.
--
-- The PK is registrationId alone, not (clubSlug, registrationId): a composite
-- key would let two clubs' rows both claim one registration. clubSlug is a
-- denormalised filter column here, as it is on registration_subscription_level.
--
-- primaryRegistrationId is ON DELETE RESTRICT while registrationId is CASCADE.
-- A member dropping its own membership row is self-consistent; a primary
-- vanishing is not — it would cascade away the group's only player_payment rows,
-- silently dissolve the group, leave every ex-member reading unpaid against a
-- still-collecting subscription, and write no audit row, because FK cascades are
-- invisible to lib/audit-log.ts by construction.
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
