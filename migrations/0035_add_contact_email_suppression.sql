-- Contact email suppression (#134).
--
-- When an admin or parent purges a player_contact address, we must not let a
-- later FA import silently recreate it as pending and mail again. Store only a
-- salted hash of the normalised address (never plaintext) scoped to the club.
-- Re-add requires an explicit admin confirmation that clears the suppression.

CREATE TABLE IF NOT EXISTS "contact_email_suppression" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "clubSlug"    TEXT NOT NULL,
  "emailHash"   TEXT NOT NULL,
  "salt"        TEXT NOT NULL,
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt"   INTEGER NOT NULL,
  UNIQUE("clubSlug", "emailHash")
);

CREATE INDEX IF NOT EXISTS "idx_contact_email_suppression_clubSlug"
  ON "contact_email_suppression" ("clubSlug");
