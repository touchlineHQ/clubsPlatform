import type { D1Database } from '@cloudflare/workers-types';
import { randomId, nowMs } from './api-helpers';

type AuditLogEntry = {
  clubSlug: string;
  adminId: string;
  action: string;
  targetTable: string;
  targetId: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  note?: string | null;
};

/** Prepare an admin audit entry so it can be included in an atomic D1 batch. */
export function prepareAuditLog(
  db: D1Database,
  {
    clubSlug,
    adminId,
    action,
    targetTable,
    targetId,
    oldStatus,
    newStatus,
    note,
  }: AuditLogEntry,
) {
  return db
    .prepare(
      `INSERT INTO "admin_audit_log"
         (id, clubSlug, adminId, action, targetTable, targetId, oldStatus, newStatus, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomId('aud'),
      clubSlug,
      adminId,
      action,
      targetTable,
      targetId,
      oldStatus ?? null,
      newStatus ?? null,
      note ?? null,
      nowMs(),
    );
}

/** Write an admin action to the audit log. */
export async function writeAuditLog(
  db: D1Database,
  entry: AuditLogEntry,
): Promise<void> {
  await prepareAuditLog(db, entry).run();
}
