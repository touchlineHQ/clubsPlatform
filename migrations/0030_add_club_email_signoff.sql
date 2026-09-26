-- Club certification that it has a lawful basis for the contact emails it hands
-- us. The club is the controller; we are the processor. See #130 / epic #128.
--
-- One row per liability so partial acceptance is representable. policyVersion
-- and wordingHash freeze the exact copy that was shown — editing the wording
-- bumps the version; existing rows keep the version they were accepted under
-- and the club must re-accept before new addresses are collected.
--
-- #75's consent_record has not landed, so this purpose-specific table stands
-- alone rather than becoming consent rows. Revisit if #75 merges first.
--
-- acceptanceId groups the three ticks from one accept action and is what
-- player_contact.signoffId references.

CREATE TABLE IF NOT EXISTS "club_email_signoff" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "acceptanceId"   TEXT NOT NULL,
  "clubSlug"       TEXT NOT NULL,
  "liability"      TEXT NOT NULL
                     CHECK("liability" IN (
                       'parental_consent',
                       'operational_split',
                       'right_to_object'
                     )),
  "userId"         TEXT NOT NULL,
  "acceptedAt"     INTEGER NOT NULL,
  "ipAddress"      TEXT,
  "policyVersion"  TEXT NOT NULL,
  "wordingHash"    TEXT NOT NULL,
  UNIQUE("clubSlug", "liability", "policyVersion")
);

CREATE INDEX IF NOT EXISTS "idx_club_email_signoff_clubSlug"
  ON "club_email_signoff" ("clubSlug");
CREATE INDEX IF NOT EXISTS "idx_club_email_signoff_acceptanceId"
  ON "club_email_signoff" ("acceptanceId");
CREATE INDEX IF NOT EXISTS "idx_club_email_signoff_club_version"
  ON "club_email_signoff" ("clubSlug", "policyVersion");
