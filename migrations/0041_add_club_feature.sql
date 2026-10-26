-- #83: per-club feature switches, starting with pitch bookings.
--
-- One row per (club, feature) that has been set explicitly. A club with no row
-- falls back to the deployment default (the PITCH_BOOKINGS env var), so this
-- migration changes nothing on its own: production has the var commented out,
-- so every club stays off until an admin turns the feature on. Its own table,
-- not a column on club_config or a key in its content blob, so content editors
-- (who can PATCH the blob) cannot switch features, and so #82's paid-tier
-- entitlements can reuse the same lookup.
CREATE TABLE IF NOT EXISTS "club_feature" ("clubSlug" TEXT NOT NULL, "feature" TEXT NOT NULL, "enabled" INTEGER NOT NULL CHECK ("enabled" IN (0, 1)), "updatedBy" TEXT, "updatedAt" INTEGER NOT NULL, PRIMARY KEY ("clubSlug", "feature"));
