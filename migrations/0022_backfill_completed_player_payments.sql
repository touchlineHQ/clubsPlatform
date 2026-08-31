-- Split "paid the plan in full" out of player_payment.status = 'inactive'.
--
-- Until now the webhook mapped both GoCardless subscription endings —
-- 'finished' (every payment of a count-limited plan collected) and 'cancelled'
-- (the payer stopped early) — to 'inactive', which the UI badges "Cancelled".
-- Players who had paid up, most visibly those on a pay-in-full level, were
-- shown as having quit, and the payer landing page would offer them the mandate
-- flow again.
--
-- No DDL: the column is bare TEXT with no CHECK constraint, so 'completed'
-- writes with no schema change and functions/lib/ensure-tables.ts is unchanged.
--
-- This recovers the rows we can prove from local data. It is idempotent — a
-- re-run matches nothing. It cannot recover:
--   * subscriptions that finished before gc_webhook_event existed (0019), or
--   * finished events GoCardless sent while we were not accepting webhooks.
-- Those stay 'inactive'; the admin retry/reconcile path in
-- functions/api/admin/player-payments.ts repairs them one at a time on demand.

UPDATE "player_payment"
   SET status = 'completed',
       updatedAt = unixepoch() * 1000
 WHERE status = 'inactive'
   AND subscriptionId IS NOT NULL
   -- GoCardless told us this subscription collected its whole plan.
   AND EXISTS (
     SELECT 1 FROM "gc_webhook_event" e
      WHERE e.resourceType = 'subscriptions'
        AND e.action = 'finished'
        AND e.subscriptionId = "player_payment".subscriptionId
   )
   -- ...and never told us it was cancelled. A *mandate* cancelled after the
   -- last collection is the normal end of a plan and deliberately does not
   -- veto the backfill — that is the case this migration exists to repair.
   AND NOT EXISTS (
     SELECT 1 FROM "gc_webhook_event" e2
      WHERE e2.resourceType = 'subscriptions'
        AND e2.action = 'cancelled'
        AND e2.subscriptionId = "player_payment".subscriptionId
   )
   -- Leave anything an admin deactivated by hand exactly as they left it.
   AND NOT EXISTS (
     SELECT 1 FROM "admin_audit_log" al
      WHERE al.targetTable = 'player_payment'
        AND al.action = 'deactivate'
        AND al.targetId = "player_payment".id
   );
