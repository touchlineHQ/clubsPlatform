-- Preserve dropped contact counts for final analytics across chunked imports.
ALTER TABLE "player_import_run_part" ADD COLUMN "contactsDropped" INTEGER NOT NULL DEFAULT 0;
