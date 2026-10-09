-- Invalidates in-flight GoCardless links when a billing group is dissolved.
-- Missing rows are generation zero, so this needs no backfill.
CREATE TABLE IF NOT EXISTS "registration_payment_state" (
  "clubSlug" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL PRIMARY KEY
    REFERENCES "player_registration"("id") ON DELETE CASCADE,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "claimId" TEXT NOT NULL DEFAULT '',
  "confirmationId" TEXT,
  "confirmationExpiresAt" INTEGER,
  "updatedAt" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_registration_payment_state_clubSlug"
  ON "registration_payment_state" ("clubSlug");
