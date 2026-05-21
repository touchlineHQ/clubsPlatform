-- SQLite has no ADD COLUMN IF NOT EXISTS, so we use the table-recreation pattern
-- to make this migration idempotent. Any startDate values already present in the
-- preview database are discarded (they are NULL test data; production never had
-- the column applied because CI failed before reaching that step).

PRAGMA foreign_keys = off;

CREATE TABLE "_subscription_level_new" (
  "id"                 TEXT    PRIMARY KEY NOT NULL,
  "clubSlug"           TEXT    NOT NULL,
  "name"               TEXT    NOT NULL,
  "yearlyPriceInPence" INTEGER NOT NULL,
  "intervalCount"      INTEGER NOT NULL DEFAULT 1,
  "intervalUnit"       TEXT    NOT NULL DEFAULT 'yearly'
    CHECK ("intervalUnit" IN ('weekly', 'monthly', 'yearly')),
  "createdAt"          INTEGER NOT NULL,
  "updatedAt"          INTEGER NOT NULL,
  "startDate"          TEXT,
  UNIQUE ("clubSlug", "name")
);

INSERT INTO "_subscription_level_new"
  ("id", "clubSlug", "name", "yearlyPriceInPence", "intervalCount", "intervalUnit", "createdAt", "updatedAt", "startDate")
  SELECT "id", "clubSlug", "name", "yearlyPriceInPence", "intervalCount", "intervalUnit", "createdAt", "updatedAt", NULL
  FROM "subscription_level";

DROP TABLE "subscription_level";

ALTER TABLE "_subscription_level_new" RENAME TO "subscription_level";

CREATE INDEX IF NOT EXISTS "idx_subscription_level_clubSlug"
  ON "subscription_level" ("clubSlug");

PRAGMA foreign_keys = on;
