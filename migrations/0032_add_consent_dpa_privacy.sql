-- Consent records, DPA acceptance (#75).
--
-- consent_record is append-only. The current state for a (club, subject,
-- purpose, channel) tuple is the latest row by recordedAt. Marketing email
-- may only go to subjects whose latest row is state='granted'.
--
-- policyVersion + wordingHash freeze the exact copy shown at grant time —
-- editing the marketing-consent wording bumps the version; existing rows keep
-- the version they were granted under.
--
-- withdrawTokenHash is set on grant rows so a one-click unsubscribe link can
-- withdraw without a login (#75 acceptance: withdrawal as easy as grant).
--
-- club_dpa_acceptance records UK GDPR Art. 28 processor-agreement acceptance
-- at club signup. Registration cannot complete without it.

CREATE TABLE IF NOT EXISTS "consent_record" (
  "id"                TEXT PRIMARY KEY NOT NULL,
  "clubSlug"          TEXT NOT NULL,
  "subjectType"       TEXT NOT NULL
                        CHECK("subjectType" IN ('player_contact', 'user')),
  "subjectId"         TEXT NOT NULL,
  "purpose"           TEXT NOT NULL
                        CHECK("purpose" IN ('marketing')),
  "channel"           TEXT NOT NULL
                        CHECK("channel" IN ('email')),
  "state"             TEXT NOT NULL
                        CHECK("state" IN ('granted', 'withdrawn')),
  "recordedAt"        INTEGER NOT NULL,
  "ipAddress"         TEXT,
  "policyVersion"     TEXT NOT NULL,
  "wordingHash"       TEXT NOT NULL,
  "withdrawTokenHash" TEXT,
  "supersedesId"      TEXT
);

CREATE INDEX IF NOT EXISTS "idx_consent_record_lookup"
  ON "consent_record" ("clubSlug", "subjectType", "subjectId", "purpose", "channel", "recordedAt");
CREATE INDEX IF NOT EXISTS "idx_consent_record_token"
  ON "consent_record" ("withdrawTokenHash");
CREATE INDEX IF NOT EXISTS "idx_consent_record_clubSlug"
  ON "consent_record" ("clubSlug");

CREATE TABLE IF NOT EXISTS "club_dpa_acceptance" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "clubSlug"       TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "acceptedAt"     INTEGER NOT NULL,
  "ipAddress"      TEXT,
  "policyVersion"  TEXT NOT NULL,
  "wordingHash"    TEXT NOT NULL,
  UNIQUE("clubSlug", "policyVersion")
);

CREATE INDEX IF NOT EXISTS "idx_club_dpa_acceptance_clubSlug"
  ON "club_dpa_acceptance" ("clubSlug");
