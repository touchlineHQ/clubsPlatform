-- An admin's "no" to a merge suggestion.
--
-- Same player, same age group is a hint, never a decision: U18 Blue and U18
-- Purple share an age group and are genuinely two sets of subs. The heuristic
-- has no memory, so without this table the one case it is most often wrong
-- about is the one it repeats after every import — which is how a useful hint
-- becomes noise an admin learns to ignore.
--
-- Keyed on the player and the normalised age group, NOT on the registration
-- ids. Ids survive a re-import, but a delete-and-recreate would resurrect an
-- id-keyed dismissal, and keying on the id set means any change at all
-- re-raises. setSize is the compromise: the suggestion stays suppressed while
-- the candidate set is no larger than what was dismissed, and re-raises when it
-- grows, so a genuinely new third registration cannot hide behind an old "no".
--
-- ageKey is LOWER(TRIM(ageGroup)), which must stay exactly equivalent to
-- normaliseAgeGroup in functions/lib/merge-suggestions.ts. Age groups arrive
-- from an FA export, which is why the normalisation exists at all.
--
-- No expiry: there is no season concept anywhere in this schema, and
-- player_registration is UNIQUE(clubSlug, playerId, teamName) so rows are
-- reused year to year. Dismissals are visible and undoable instead.
--
-- playerId, not fanId: player.fanId is NOT NULL UNIQUE so the two are 1:1, but
-- the FK belongs on the primary key. Holds no PII — playerId is not the FAN.
CREATE TABLE IF NOT EXISTS "registration_merge_suggestion_dismissal" (
  "clubSlug"    TEXT NOT NULL,
  "playerId"    TEXT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "ageKey"      TEXT NOT NULL,
  "setSize"     INTEGER NOT NULL,
  "dismissedBy" TEXT NOT NULL,
  "dismissedAt" INTEGER NOT NULL,
  PRIMARY KEY ("clubSlug", "playerId", "ageKey")
);

-- Serves the candidate grouping: a club-scoped walk in (playerId, ageGroup)
-- order, instead of a filtered scan feeding a temp B-tree for the GROUP BY.
-- ageGroup is last and uncollated because the grouping keys on LOWER(TRIM(...))
-- rather than on the column, so this orders the walk without serving equality.
CREATE INDEX IF NOT EXISTS "idx_player_registration_club_player_age"
  ON "player_registration" ("clubSlug", "playerId", "ageGroup");
