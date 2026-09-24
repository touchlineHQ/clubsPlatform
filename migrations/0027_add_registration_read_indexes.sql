-- Indexes for the club-wide registrations read, which had none that fit it.
--
-- admin_audit_log carried clubSlug, targetId and createdAt as three SEPARATE
-- single-column indexes. SQLite uses one index per table reference and does not
-- intersect them, so the manual-attribution lookup could only ever use one of
-- its three predicates and scanned the club's whole audit log otherwise. That
-- table is append-only and never pruned, so the read degraded with admin
-- activity rather than data volume — worst for the most engaged clubs.
CREATE INDEX IF NOT EXISTS "idx_admin_audit_log_target"
  ON "admin_audit_log" ("targetId", "clubSlug", "action", "createdAt");

-- The payment-status CASE is now keyed on the billing registration and is
-- evaluated more than once per row on a filtered or sorted read. Carrying
-- "status" in the index makes each probe index-only; idx_player_payment_
-- registrationId finds the rows but still has to fetch each one for its status.
CREATE INDEX IF NOT EXISTS "idx_player_payment_reg_status"
  ON "player_payment" ("registrationId", "status");

-- Serves "WHERE clubSlug = ?" on every read, the team filter, and the default
-- "ORDER BY teamName" — the trailing "id" covers the tiebreak the paginated
-- endpoint will append, so the whole ordering comes from one index walk.
--
-- COLLATE NOCASE is load-bearing, not decoration: a BINARY index cannot serve a
-- NOCASE ORDER BY at all, and the comparison this replaces is case-insensitive.
CREATE INDEX IF NOT EXISTS "idx_player_registration_club_team"
  ON "player_registration" ("clubSlug", "teamName" COLLATE NOCASE, "id");

-- Serves the status filter, and the SELECT DISTINCT registrationStatus that
-- status-subscription-levels.ts already runs as an index-only scan.
CREATE INDEX IF NOT EXISTS "idx_player_registration_club_status"
  ON "player_registration" ("clubSlug", "registrationStatus" COLLATE NOCASE);
