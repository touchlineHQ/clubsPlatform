CREATE TABLE IF NOT EXISTS "player_payment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL REFERENCES "player_registration"("id") ON DELETE CASCADE,
  "reference" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE("clubSlug", "reference")
);
CREATE INDEX IF NOT EXISTS "idx_player_payment_registrationId" ON "player_payment" ("registrationId");
CREATE INDEX IF NOT EXISTS "idx_player_payment_mandateId" ON "player_payment" ("mandateId");
