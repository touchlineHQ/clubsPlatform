-- One row per committed player import, so the Registrations page can say how
-- stale the data on screen is. Dry-run previews write nothing here.
CREATE TABLE IF NOT EXISTS "club_import_log" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "importedAt" INTEGER NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "adminId" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_club_import_log_clubSlug_importedAt" ON "club_import_log" ("clubSlug", "importedAt");
