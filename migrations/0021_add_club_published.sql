-- A club can be onboarded before its public site is ready. `published` = 0 keeps
-- every page reachable to that club's admins while anyone else is sent to the
-- platform landing page. Distinct from `active`, which is a soft delete and hides
-- the club from admins too.
--
-- Defaults to 1 so every club already on the platform stays live; only clubs
-- created after this migration (and clubs an admin deliberately takes offline)
-- start private.
ALTER TABLE "club_config" ADD COLUMN "published" INTEGER NOT NULL DEFAULT 1;
