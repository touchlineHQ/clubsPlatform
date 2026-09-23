import { describe, it, expect } from 'vitest';
import {
  batchRows, IMPORT_CHUNK_ROWS, IMPORT_CHUNK_EMAILS,
} from '../../pages/admin-users/ImportPlayersPanel';
import type { ParsedPlayerRow } from '../../utils/faPlayerReport';

const row = (i: number, emails: string[] = []): ParsedPlayerRow => ({
  fanId: `FAN${i}`, ageGroup: 'U11', teamName: 'U11 Boys',
  registrationExpiry: '2025-07-31', registrationStatus: 'Active',
  playerEmail: '', parentEmails: emails,
});

/** Distinct addresses a batch carries, as the server counts them. */
const emailsIn = (batch: ParsedPlayerRow[]) =>
  new Set(batch.flatMap(r => [r.playerEmail, ...r.parentEmails])
    .map(e => e.trim().toLowerCase()).filter(Boolean)).size;

describe('batchRows', () => {
  it('batches on rows when addresses are ordinary', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i, [`m${i}@e.com`, `d${i}@e.com`]));
    const batches = batchRows(rows);

    expect(batches.every(b => b.length <= IMPORT_CHUNK_ROWS)).toBe(true);
    expect(batches[0]).toHaveLength(IMPORT_CHUNK_ROWS);
    expect(batches.flat()).toHaveLength(40);
  });

  it('closes a batch early when a file is address-heavy', () => {
    // The case that forced this: 15 rows at 11 addresses each is 165 accounts,
    // past the CPU budget however few the rows.
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(i, Array.from({ length: 11 }, (_, j) => `p${i}-${j}@e.com`)));
    const batches = batchRows(rows);

    expect(Math.max(...batches.map(emailsIn))).toBeLessThanOrEqual(IMPORT_CHUNK_EMAILS);
    expect(batches[0].length).toBeLessThan(IMPORT_CHUNK_ROWS);
  });

  it('never exceeds either limit, whatever the shape', () => {
    // Mixed: most rows ordinary, every seventh carrying the maximum.
    const rows = Array.from({ length: 100 }, (_, i) =>
      row(i, i % 7 === 0
        ? Array.from({ length: 11 }, (_, j) => `p${i}-${j}@e.com`)
        : [`m${i}@e.com`, `d${i}@e.com`]));

    for (const batch of batchRows(rows)) {
      expect(batch.length).toBeLessThanOrEqual(IMPORT_CHUNK_ROWS);
      expect(emailsIn(batch)).toBeLessThanOrEqual(IMPORT_CHUNK_EMAILS);
    }
  });

  it('loses no row and keeps them in order', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row(i, i % 7 === 0
        ? Array.from({ length: 11 }, (_, j) => `p${i}-${j}@e.com`)
        : [`m${i}@e.com`]));

    expect(batchRows(rows).flat().map(r => r.fanId)).toEqual(rows.map(r => r.fanId));
  });

  it('counts a shared address once, so siblings do not split a batch early', () => {
    const rows = Array.from({ length: IMPORT_CHUNK_ROWS }, (_, i) => row(i, ['one@e.com']));
    expect(batchRows(rows)).toHaveLength(1);
  });

  it('returns nothing for an empty file', () => {
    expect(batchRows([])).toEqual([]);
  });
});
