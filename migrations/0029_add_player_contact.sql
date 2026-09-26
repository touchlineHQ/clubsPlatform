-- Contact email is Direct PII and must not live on the auth identity.
--
-- Until now import-players.ts wrote every FA CSV address into "user" +
-- "account" + "user_player". That conflated four lifecycles (login, contact,
-- consent, retention) into one UNIQUE(email) row, so an address could not be
-- held pending, purged without destroying a login, or shared across siblings.
-- See #131 / epic #128.
--
-- player_contact is keyed to the player (and the club), not the account.
-- state starts at pending: an address is not contactable until the parent
-- activates (#132). operationalOptIn / marketingOptIn default off; marketing
-- is never settable by a club admin (enforced by the send helper / #133).
-- signoffId is nullable until #130 lands the club sign-off table.
--
-- #75's consent_record has not landed, so the two opt-in columns stay here
-- rather than becoming consent rows. Revisit if #75 merges first.
--
-- Existing import-created accounts are backfilled as pending — they were never
-- asked. Credentials on those rows are left alone here; invalidating the
-- FAN-derived password is coordinated with #72 / the activation flow, which
-- is what gives the parent a path back in.

CREATE TABLE IF NOT EXISTS "player_contact" (
  "id"                   TEXT PRIMARY KEY NOT NULL,
  "clubSlug"             TEXT NOT NULL,
  "playerId"             TEXT NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "email"                TEXT NOT NULL,
  "relationship"         TEXT NOT NULL CHECK("relationship" IN ('self', 'guardian')),
  "state"                TEXT NOT NULL DEFAULT 'pending'
                           CHECK("state" IN ('pending', 'confirmed', 'withdrawn', 'bounced')),
  "operationalOptIn"     INTEGER NOT NULL DEFAULT 0,
  "marketingOptIn"       INTEGER NOT NULL DEFAULT 0,
  "sourcedBy"            TEXT,
  "sourcedAt"            INTEGER NOT NULL,
  "signoffId"            TEXT,
  "confirmedAt"          INTEGER,
  "withdrawnAt"          INTEGER,
  "activationTokenHash"  TEXT,
  "activationExpiresAt"  INTEGER,
  UNIQUE("clubSlug", "playerId", "email")
);

CREATE INDEX IF NOT EXISTS "idx_player_contact_clubSlug"
  ON "player_contact" ("clubSlug");
CREATE INDEX IF NOT EXISTS "idx_player_contact_playerId"
  ON "player_contact" ("playerId");
CREATE INDEX IF NOT EXISTS "idx_player_contact_email"
  ON "player_contact" ("email");


-- Import signature: empty name, role member, a user_player link, and a club.
-- Never mark these confirmed — the parent was never asked.
--
-- Completeness limit: users who later set a display name (name != '') no longer
-- match and will not get a player_contact row — their address stays on
-- user.email until re-import or a follow-up migration. Do not broaden this
-- WHERE on an already-applied migration (FAN-password / emailVerified are not
-- a safe signature here). Track leftovers under epic #128 / #131.
INSERT INTO "player_contact" (
  "id", "clubSlug", "playerId", "email", "relationship", "state",
  "operationalOptIn", "marketingOptIn", "sourcedBy", "sourcedAt", "signoffId",
  "confirmedAt", "withdrawnAt", "activationTokenHash", "activationExpiresAt"
)
SELECT
  'pcontact_' || lower(hex(randomblob(16))),
  u."clubSlug",
  up."playerId",
  lower(u."email"),
  up."relationship",
  'pending',
  0,
  0,
  NULL,
  u."createdAt",
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM "user" u
JOIN "user_player" up ON up."userId" = u."id"
WHERE u."role" = 'member'
  AND u."name" = ''
  AND u."clubSlug" IS NOT NULL
  AND TRIM(u."email") != ''
  AND NOT EXISTS (
    SELECT 1 FROM "player_contact" pc
     WHERE pc."clubSlug" = u."clubSlug"
       AND pc."playerId" = up."playerId"
       AND pc."email" = lower(u."email")
  );
