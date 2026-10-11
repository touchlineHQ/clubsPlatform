-- Activation mail tracking (#132).
--
-- activationSentAt: when the welcome / activation mail was last sent (NULL =
-- not yet sent; the send batch picks these up). reminderSentAt: the single
-- reminder a pending contact may receive before it lapses.

ALTER TABLE "player_contact" ADD COLUMN "activationSentAt" INTEGER;
ALTER TABLE "player_contact" ADD COLUMN "reminderSentAt" INTEGER;

CREATE INDEX IF NOT EXISTS "idx_player_contact_pending_sweep"
  ON "player_contact" ("clubSlug", "state", "activationSentAt");
