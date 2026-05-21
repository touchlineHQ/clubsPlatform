-- Optional first payment date for a subscription level. When set, subscriptions
-- created for this level will start on that date (or the first of the next
-- month if that date is already in the past).

ALTER TABLE "subscription_level" ADD COLUMN "startDate" TEXT;
