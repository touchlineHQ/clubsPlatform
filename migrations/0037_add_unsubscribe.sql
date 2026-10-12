-- One-click unsubscribe (#135).
--
-- unsubscribe_token: one row per recipient per send. Only the SHA-256 of a
-- 256-bit random token is stored; the URL carries the token and nothing else
-- (no address, no contact id). usedAt makes it single-use for the destructive
-- purge action; expired / used tokens still open the preference page and can
-- still withdraw, because a withdrawal attempt must never fail.
--
-- contact_withdrawal: the audit trail. When, what was withdrawn, how, and
-- which send it came from (batchId). No address is stored; contactId stays as
-- an opaque id even after a purge deletes the contact row.

CREATE TABLE IF NOT EXISTS "unsubscribe_token" (
  "tokenHash"  TEXT PRIMARY KEY NOT NULL,
  "clubSlug"   TEXT NOT NULL,
  "contactId"  TEXT NOT NULL,
  "purpose"    TEXT NOT NULL CHECK("purpose" IN ('transactional', 'operational', 'marketing')),
  "batchId"    TEXT,
  "createdAt"  INTEGER NOT NULL,
  "expiresAt"  INTEGER NOT NULL,
  "usedAt"     INTEGER
);

CREATE INDEX IF NOT EXISTS "idx_unsubscribe_token_contact"
  ON "unsubscribe_token" ("clubSlug", "contactId");

CREATE TABLE IF NOT EXISTS "contact_withdrawal" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "clubSlug"   TEXT NOT NULL,
  "contactId"  TEXT NOT NULL,
  "scope"      TEXT NOT NULL CHECK("scope" IN ('marketing', 'all', 'purge', 'bounce')),
  "source"     TEXT NOT NULL CHECK("source" IN ('link', 'one_click', 'complaint', 'bounce')),
  "purpose"    TEXT,
  "batchId"    TEXT,
  "createdAt"  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_contact_withdrawal_club_createdAt"
  ON "contact_withdrawal" ("clubSlug", "createdAt");

-- Bounce / complaint webhooks resolve the provider message id to a send.
CREATE INDEX IF NOT EXISTS "idx_email_send_event_providerMessageId"
  ON "email_send_event" ("providerMessageId");
