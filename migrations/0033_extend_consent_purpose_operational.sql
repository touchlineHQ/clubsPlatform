-- Parent-facing contact consent (#149).
--
-- Operational agreement (fixtures / safety / kit / subs reminders) is Contract /
-- legitimate interests, but we still record the exact wording the parent saw,
-- with time and IP, on consent_record — same evidence pattern as marketing.
-- Existing rows are marketing-only; rebuild the CHECK to allow 'operational'.

CREATE TABLE "consent_record_new" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "clubSlug"         TEXT NOT NULL,
  "subjectType"      TEXT NOT NULL CHECK("subjectType" IN ('player_contact', 'user')),
  "subjectId"        TEXT NOT NULL,
  "purpose"          TEXT NOT NULL CHECK("purpose" IN ('marketing', 'operational')),
  "channel"          TEXT NOT NULL CHECK("channel" IN ('email')),
  "state"            TEXT NOT NULL CHECK("state" IN ('granted', 'withdrawn')),
  "recordedAt"       INTEGER NOT NULL,
  "ipAddress"        TEXT,
  "policyVersion"    TEXT NOT NULL,
  "wordingHash"      TEXT NOT NULL,
  "withdrawTokenHash" TEXT,
  "supersedesId"     TEXT
);

INSERT INTO "consent_record_new"
  SELECT id, clubSlug, subjectType, subjectId, purpose, channel, state,
         recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId
    FROM "consent_record";

DROP TABLE "consent_record";
ALTER TABLE "consent_record_new" RENAME TO "consent_record";

CREATE INDEX IF NOT EXISTS "idx_consent_record_lookup"
  ON "consent_record" ("clubSlug", "subjectType", "subjectId", "purpose", "channel", "recordedAt");
CREATE INDEX IF NOT EXISTS "idx_consent_record_token"
  ON "consent_record" ("withdrawTokenHash");
CREATE INDEX IF NOT EXISTS "idx_consent_record_clubSlug"
  ON "consent_record" ("clubSlug");

-- Lookup activation tokens for the parent consent form without a table scan.
CREATE INDEX IF NOT EXISTS "idx_player_contact_activation_token"
  ON "player_contact" ("activationTokenHash");
