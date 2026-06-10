import type { D1Database } from '@cloudflare/workers-types';
import { randomId, nowMs } from './api-helpers';

export async function writeAuditLog(
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
  }: {
    clubSlug: string;
    adminId: string;
    action: string;
    targetTable: string;
    targetId: string;
    oldStatus?: string | null;
    newStatus?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db
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
    )
    .run();
}
