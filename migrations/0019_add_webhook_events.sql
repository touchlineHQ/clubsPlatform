CREATE TABLE IF NOT EXISTS "gc_webhook_event" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "resourceType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "mandateId" TEXT,
  "subscriptionId" TEXT,
  "paymentId" TEXT,
  "rawBody" TEXT NOT NULL,
  "receivedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_gc_webhook_event_mandateId" ON "gc_webhook_event" ("mandateId");
CREATE INDEX IF NOT EXISTS "idx_gc_webhook_event_subscriptionId" ON "gc_webhook_event" ("subscriptionId");
CREATE INDEX IF NOT EXISTS "idx_gc_webhook_event_receivedAt" ON "gc_webhook_event" ("receivedAt");
