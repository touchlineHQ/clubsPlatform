import { describe, expect, it, type Mock } from 'vitest';
import { prepareAuditLog } from '../../lib/audit-log';
import { makeDb } from '../test-utils';

const entry = {
  clubSlug: 'test-club',
  adminId: 'admin-1',
  action: 'registrations_merged',
  targetTable: 'player_registration',
  targetId: 'reg-1',
};

describe('prepareAuditLog', () => {
  it('prepares the ordinary unconditional audit insert', () => {
    const db = makeDb();

    prepareAuditLog(db as any, entry);

    const sql = String((db.prepare as Mock).mock.calls[0][0]);
    expect(sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    expect(sql).not.toContain('SELECT NULL');
  });

  it('turns a false guard into a constraint failure for transactional batches', () => {
    const db = makeDb();

    prepareAuditLog(db as any, entry, {
      sql: 'EXISTS (SELECT 1 FROM "registration_merge" WHERE "registrationId" = ?)',
      bindings: ['reg-1'],
    });

    const prepare = db.prepare as Mock;
    const sql = String(prepare.mock.calls[0][0]);
    const bindings = prepare.mock.results[0].value.bind.mock.calls[0] as unknown[];
    expect(sql).toContain('SELECT NULL');
    expect(sql.match(/EXISTS \(SELECT 1 FROM "registration_merge"/g)).toHaveLength(2);
    expect(bindings.filter(value => value === 'reg-1')).toHaveLength(4);
  });
});
