CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubSlug" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "note" TEXT,
  "createdAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_admin_audit_log_clubSlug" ON "admin_audit_log" ("clubSlug");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_log_targetId" ON "admin_audit_log" ("targetId");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_log_createdAt" ON "admin_audit_log" ("createdAt");
