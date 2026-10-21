-- #74: a team's WhatsApp group invite link.
--
-- Deliberately its own table rather than a column on "team": every participant
-- in a WhatsApp group can see every other participant's phone number, so the
-- link must never ride along on the public GET /api/teams. Keeping it out of
-- the team row means no SELECT on "team" can leak it. Read only through
-- /api/team-group-link, which checks the caller is assigned to the team.
CREATE TABLE IF NOT EXISTS "team_group_link" ("clubSlug" TEXT NOT NULL, "teamSlug" TEXT NOT NULL, "teamLeague" TEXT NOT NULL, "url" TEXT NOT NULL, "updatedBy" TEXT, "updatedAt" INTEGER NOT NULL, PRIMARY KEY ("clubSlug", "teamSlug", "teamLeague"));
