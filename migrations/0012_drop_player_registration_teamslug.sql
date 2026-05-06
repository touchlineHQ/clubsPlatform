-- Drop the old unique index that referenced teamSlug
DROP INDEX IF EXISTS "uq_player_registration_club_player_team";

-- Remove the teamSlug column
ALTER TABLE "player_registration" DROP COLUMN "teamSlug";

-- New unique constraint keyed on teamName instead
CREATE UNIQUE INDEX IF NOT EXISTS "uq_player_registration_club_player_teamname"
  ON "player_registration" ("clubSlug", "playerId", "teamName");
