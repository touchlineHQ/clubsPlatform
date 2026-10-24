-- #77: failed Direct Debit collections, so the arrears view can tell a failed
-- payment apart from a registration that never set one up. One row per
-- GoCardless payment; resolvedAt is set when a later payment on the same
-- mandate is confirmed. Holds GoCardless ids only — no payer details.
CREATE TABLE IF NOT EXISTS "payment_failure" ("paymentId" TEXT PRIMARY KEY NOT NULL, "clubSlug" TEXT NOT NULL, "registrationId" TEXT NOT NULL REFERENCES "player_registration"("id") ON DELETE CASCADE, "mandateId" TEXT, "cause" TEXT, "failedAt" INTEGER NOT NULL, "resolvedAt" INTEGER);
CREATE INDEX IF NOT EXISTS "idx_payment_failure_registration" ON "payment_failure" ("registrationId", "resolvedAt");
CREATE INDEX IF NOT EXISTS "idx_payment_failure_mandate" ON "payment_failure" ("mandateId");
-- Latest confirmed/paid_out event time per mandate, so a failure delivered
-- after a newer success (GoCardless doesn't guarantee order) isn't left open.
CREATE TABLE IF NOT EXISTS "payment_success" ("mandateId" TEXT PRIMARY KEY NOT NULL, "lastSuccessAt" INTEGER NOT NULL);
