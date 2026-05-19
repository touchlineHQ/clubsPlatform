-- Content tables present in ensure-tables.ts but previously missing from
-- D1 migrations. All use IF NOT EXISTS so this is safe on any DB state.

CREATE TABLE IF NOT EXISTS "registration_item" (
  "id"          TEXT    PRIMARY KEY NOT NULL,
  "clubSlug"    TEXT,
  "icon"        TEXT    NOT NULL,
  "title"       TEXT    NOT NULL,
  "description" TEXT    NOT NULL,
  "link"        TEXT    NOT NULL,
  "buttonText"  TEXT    NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   INTEGER NOT NULL,
  "updatedAt"   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_registration_item_sortOrder" ON "registration_item" ("sortOrder");

CREATE TABLE IF NOT EXISTS "gallery_item" (
  "id"        TEXT    PRIMARY KEY NOT NULL,
  "clubSlug"  TEXT,
  "src"       TEXT,
  "caption"   TEXT    NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_gallery_item_sortOrder" ON "gallery_item" ("sortOrder");

CREATE TABLE IF NOT EXISTS "matchday_item" (
  "id"        TEXT    PRIMARY KEY NOT NULL,
  "clubSlug"  TEXT,
  "icon"      TEXT    NOT NULL,
  "title"     TEXT    NOT NULL,
  "text"      TEXT    NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_matchday_item_sortOrder" ON "matchday_item" ("sortOrder");

CREATE TABLE IF NOT EXISTS "status_subscription_level" (
  "clubSlug"            TEXT NOT NULL,
  "registrationStatus"  TEXT NOT NULL,
  "subscriptionLevelId" TEXT NOT NULL
    REFERENCES "subscription_level"("id") ON DELETE CASCADE,
  "updatedAt"           INTEGER NOT NULL,
  PRIMARY KEY ("clubSlug", "registrationStatus")
);

CREATE TABLE IF NOT EXISTS "team_status_subscription_level" (
  "clubSlug"            TEXT NOT NULL,
  "teamName"            TEXT NOT NULL,
  "registrationStatus"  TEXT NOT NULL,
  "subscriptionLevelId" TEXT NOT NULL
    REFERENCES "subscription_level"("id") ON DELETE CASCADE,
  "updatedAt"           INTEGER NOT NULL,
  PRIMARY KEY ("clubSlug", "teamName", "registrationStatus")
);
CREATE INDEX IF NOT EXISTS "idx_team_status_sub_level_clubTeam"
  ON "team_status_subscription_level" ("clubSlug", "teamName");
