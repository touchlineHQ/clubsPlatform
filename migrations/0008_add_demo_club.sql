-- Seed the demo club so it appears in the multi-club registry
INSERT OR IGNORE INTO "club_config" ("id", "slug", "name", "active", "createdAt")
VALUES ('club_demo', 'demo', 'Demo United FC', 1, unixepoch() * 1000);
