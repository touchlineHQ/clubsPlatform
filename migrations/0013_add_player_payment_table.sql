CREATE TABLE IF NOT EXISTS "player_payment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "fanId" TEXT NOT NULL,
  "teamName" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "amountInPence" INTEGER,
  "intervalUnit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE("clubSlug", "reference")
);
CREATE INDEX IF NOT EXISTS "idx_player_payment_clubSlug_fanId" ON "player_payment" ("clubSlug", "fanId");
CREATE INDEX IF NOT EXISTS "idx_player_payment_mandateId" ON "player_payment" ("mandateId");
