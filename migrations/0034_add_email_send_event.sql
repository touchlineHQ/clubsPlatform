-- Outbound email send / drop audit (#133).
--
-- Every club contact send records purpose, recipient contact id, and the
-- consent / registration state relied on. Dropped recipients keep a reason so
-- an admin can see why someone was excluded (pending, no marketing opt-in,
-- lapsed registration). Addresses are NOT stored — contactId is enough.
--
-- providerMessageId is nullable until a real provider (#72) lands; unconfigured
-- deploys still write eligibility rows with outcome skipped_unconfigured.

CREATE TABLE IF NOT EXISTS "email_send_event" (
  "id"                     TEXT PRIMARY KEY NOT NULL,
  "clubSlug"               TEXT NOT NULL,
  "batchId"                TEXT NOT NULL,
  "purpose"                TEXT NOT NULL
                             CHECK("purpose" IN ('transactional', 'operational', 'marketing')),
  "contactId"              TEXT NOT NULL,
  "outcome"                TEXT NOT NULL
                             CHECK("outcome" IN ('sent', 'dropped', 'skipped_unconfigured')),
  "dropReason"             TEXT
                             CHECK("dropReason" IS NULL OR "dropReason" IN (
                               'pending',
                               'withdrawn',
                               'bounced',
                               'not_confirmed',
                               'missing_marketing_consent',
                               'lapsed_registration',
                               'no_operational_opt_in',
                               'not_found',
                               'duplicate_email',
                               'provider_rejected'
                             )),
  "contactState"           TEXT,
  "operationalOptIn"       INTEGER,
  "marketingOptIn"         INTEGER,
  "marketingConsentState"  TEXT,
  "registrationStatus"     TEXT,
  "audienceType"           TEXT NOT NULL,
  "audienceKey"            TEXT,
  "initiatedBy"            TEXT,
  "providerMessageId"      TEXT,
  "createdAt"              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_send_event_club_createdAt"
  ON "email_send_event" ("clubSlug", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_email_send_event_club_outcome"
  ON "email_send_event" ("clubSlug", "outcome", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_email_send_event_batchId"
  ON "email_send_event" ("batchId");
CREATE INDEX IF NOT EXISTS "idx_email_send_event_contactId"
  ON "email_send_event" ("contactId");
