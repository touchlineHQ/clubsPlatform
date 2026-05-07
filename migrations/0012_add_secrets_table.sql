CREATE TABLE IF NOT EXISTS "club_secret" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT,
  "key" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_club_secret_slug_key"
  ON "club_secret" (COALESCE("clubSlug",''), "key");
