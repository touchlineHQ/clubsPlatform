-- Server-side coordination for CPU-bounded player-import chunks. The run row
-- scopes every part to one club/admin and the part rows are the source of truth
-- for final row and result counts.
CREATE TABLE IF NOT EXISTS "player_import_run" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "totalParts" INTEGER NOT NULL,
  "nextPart" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "completedAt" INTEGER
);
CREATE INDEX IF NOT EXISTS "idx_player_import_run_club_createdAt"
  ON "player_import_run" ("clubSlug", "createdAt");

CREATE TABLE IF NOT EXISTS "player_import_run_part" (
  "runId" TEXT NOT NULL REFERENCES "player_import_run"("id") ON DELETE CASCADE,
  "partIndex" INTEGER NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "playersCreated" INTEGER NOT NULL,
  "registrationsCreated" INTEGER NOT NULL,
  "registrationsUpdated" INTEGER NOT NULL,
  "usersCreated" INTEGER NOT NULL,
  "usersSkipped" INTEGER NOT NULL,
  "errorCount" INTEGER NOT NULL,
  "recordedAt" INTEGER NOT NULL,
  PRIMARY KEY ("runId", "partIndex")
);
