-- Add secondaryColor to club_config using table-recreation (SQLite has no
-- ADD COLUMN IF NOT EXISTS), making this idempotent whether or not the column
-- was already added by an earlier ensure-tables COLUMN_MIGRATIONS run.
--
-- data and seeded are intentionally excluded: they have no D1 migration and
-- are managed by ensure-tables.ts COLUMN_MIGRATIONS (added with try/catch at
-- worker startup). On first request after deployment, seedClubData() re-runs
-- via seeded=0; all content inserts use INSERT OR IGNORE so rows are preserved.
CREATE TABLE "club_config_new" (
  "id"             TEXT    PRIMARY KEY NOT NULL,
  "slug"           TEXT    NOT NULL UNIQUE,
  "name"           TEXT    NOT NULL,
  "active"         INTEGER NOT NULL DEFAULT 1,
  "primaryColor"   TEXT,
  "secondaryColor" TEXT,
  "createdAt"      INTEGER NOT NULL
);
INSERT INTO "club_config_new" ("id", "slug", "name", "active", "primaryColor", "secondaryColor", "createdAt")
  SELECT "id", "slug", "name", "active", "primaryColor", NULL, "createdAt"
  FROM "club_config";
DROP TABLE "club_config";
ALTER TABLE "club_config_new" RENAME TO "club_config";
