-- Manual fixtures and results (#78).
--
-- Entries a club records itself: friendlies, cup games, tournaments, or a
-- result the league feed has not published yet. Merged with the FA Full-Time
-- feed for display; the feed wins on conflict (same team, same date).
-- homeScore / awayScore NULL = not played yet (a fixture, not a result).

CREATE TABLE IF NOT EXISTS "manual_fixture" ("id" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT, "team" TEXT NOT NULL, "date" TEXT NOT NULL, "time" TEXT NOT NULL DEFAULT '', "homeAway" TEXT NOT NULL CHECK("homeAway" IN ('home', 'away')), "opponent" TEXT NOT NULL, "venue" TEXT NOT NULL DEFAULT '', "competition" TEXT NOT NULL DEFAULT '', "homeScore" INTEGER, "awayScore" INTEGER, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS "idx_manual_fixture_club_date" ON "manual_fixture" ("clubSlug", "date");
