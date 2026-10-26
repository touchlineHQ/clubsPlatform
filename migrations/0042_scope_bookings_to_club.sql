-- #83: pitch bookings are a per-club feature, so bookings and booking requests
-- belong to a club. The clubSlug columns exist since 0007; the booking pages
-- just never sent X-Club-Slug, so rows were written with no club.
--
-- Backfill those club-less rows to the deployment's default club where one can
-- be resolved:
--   1. a booking takes the club of the request it was approved from;
--   2. otherwise, with exactly one active club, rows go to that club (the
--      only club a header-less booking page could have been serving).
-- With several active clubs and no request to inherit from there is no safe
-- default, so those rows stay NULL; the APIs only show NULL rows to requests
-- that send no club (the old behaviour).
--
-- Pitches are not backfilled: club-less pitches are the shared default set
-- (0004's seed) that every club sees, alongside any pitches it owns.

UPDATE "booking"
SET "clubSlug" = (SELECT br."clubSlug" FROM "booking_request" br WHERE br."id" = "booking"."requestId")
WHERE "clubSlug" IS NULL
  AND "requestId" IS NOT NULL
  AND (SELECT br."clubSlug" FROM "booking_request" br WHERE br."id" = "booking"."requestId") IS NOT NULL;

UPDATE "booking_request"
SET "clubSlug" = (SELECT "slug" FROM "club_config" WHERE "active" = 1)
WHERE "clubSlug" IS NULL
  AND (SELECT COUNT(*) FROM "club_config" WHERE "active" = 1) = 1;

UPDATE "booking"
SET "clubSlug" = (SELECT "slug" FROM "club_config" WHERE "active" = 1)
WHERE "clubSlug" IS NULL
  AND (SELECT COUNT(*) FROM "club_config" WHERE "active" = 1) = 1;

CREATE INDEX IF NOT EXISTS "idx_booking_club_date" ON "booking" ("clubSlug", "date");
CREATE INDEX IF NOT EXISTS "idx_booking_request_club_status" ON "booking_request" ("clubSlug", "status");
