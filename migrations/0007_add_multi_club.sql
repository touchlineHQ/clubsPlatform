-- Club registry (source of truth for multi-club mode)
CREATE TABLE IF NOT EXISTS "club_config" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" INTEGER NOT NULL
);

-- Seed default club
INSERT OR IGNORE INTO "club_config" ("id", "slug", "name", "active", "createdAt")
VALUES ('club_east-leake', 'east-leake', 'East Leake FC', 1, unixepoch() * 1000);

-- Add clubSlug to content/auth tables (nullable = backward compatible with single-club)
ALTER TABLE "news_item"        ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "committee_member" ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "pitch"            ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "booking_request"  ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "booking"          ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "user_team_role"   ADD COLUMN "clubSlug" TEXT;
ALTER TABLE "user"             ADD COLUMN "clubSlug" TEXT;

-- Recreate team_section: remove UNIQUE(sectionKey), add composite UNIQUE(clubSlug, sectionKey)
-- so multiple clubs can share the same sectionKey value
CREATE TABLE "team_section_new" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT,
  "sectionKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "logo" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

INSERT INTO "team_section_new"
  SELECT "id", NULL, "sectionKey", "name", "subtitle", "icon", "logo", "sortOrder", "createdAt", "updatedAt"
  FROM "team_section";

DROP TABLE "team_section";
ALTER TABLE "team_section_new" RENAME TO "team_section";

CREATE UNIQUE INDEX "uq_team_section_club_key"
  ON "team_section" (COALESCE("clubSlug", ''), "sectionKey");
CREATE INDEX "idx_team_section_sortOrder"
  ON "team_section" ("sortOrder");
