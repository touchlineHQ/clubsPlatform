import { describe, it, expect } from 'vitest';
import {
  IMPORT_COLUMNS,
  formatCellDate,
  formatReportDate,
  parseImportSheet,
  parseReportSheet,
} from '../../utils/faPlayerReport';

/** The keys the player import has always posted, in order. */
const IMPORT_KEYS = [
  'fanId', 'ageGroup', 'teamName', 'registrationExpiry', 'registrationStatus',
  'playerEmail', 'parentEmails',
];

/** Title rows above the headers, and the personal columns beside the operational ones. */
const SHEET: unknown[][] = [
  ['The Football Association'],
  ['Club - Player Report', '', '', 'Generated 21/09/2026'],
  [
    'FAN ID', 'First Names', 'Surname', 'Date of birth', 'Age Group', 'Team',
    'Registration Status', 'Registration Expiry', 'Email Address',
    'Parent/Carer Email Address',
  ],
  [
    'FAN001', 'Ada', 'Lovelace', new Date(2009, 10, 4), 'U15', 'U15 Bantams Blue',
    'Active', new Date(2026, 7, 1), 'Ada@Example.com', 'mum@example.com, dad@example.com',
  ],
  ['', '', '', '', '', '', '', '', '', ''],
  [
    'FAN002', 'Grace', 'Hopper', 40121, 'U18', 'U18 Reds',
    'Cancelled', '01/08/2026', '', '',
  ],
];

describe('parseImportSheet', () => {
  it('finds the header row by scanning for FAN ID rather than assuming a position', () => {
    const { parsed, errors } = parseImportSheet(SHEET);
    expect(errors).toEqual([]);
    expect(parsed.map(r => r.fanId)).toEqual(['FAN001', 'FAN002']);
  });

  // Guards #94: the sheet has names and DOB, the import's spec must leave them behind.
  it('emits only the seven operational keys, even from a sheet carrying names and DOB', () => {
    const { parsed } = parseImportSheet(SHEET);
    for (const row of parsed) expect(Object.keys(row)).toEqual(IMPORT_KEYS);
    expect(JSON.stringify(parsed)).not.toMatch(/Lovelace|Hopper|Ada|Grace/);
  });

  it('keeps the personal columns out of the import spec entirely', () => {
    expect(IMPORT_COLUMNS.firstNames).toBeUndefined();
    expect(IMPORT_COLUMNS.surname).toBeUndefined();
    expect(IMPORT_COLUMNS.dateOfBirth).toBeUndefined();
  });

  it('lowercases the player email and comma-splits parent emails', () => {
    const { parsed } = parseImportSheet(SHEET);
    expect(parsed[0].playerEmail).toBe('ada@example.com');
    expect(parsed[0].parentEmails).toEqual(['mum@example.com', 'dad@example.com']);
    expect(parsed[1].parentEmails).toEqual([]);
  });

  it('skips rows with a blank FAN ID', () => {
    const { parsed } = parseImportSheet(SHEET);
    expect(parsed).toHaveLength(2);
  });

  it('reports a readable error instead of throwing when there is no FAN ID header', () => {
    const { parsed, errors } = parseImportSheet([['Name', 'Team'], ['Ada', 'U15']]);
    expect(parsed).toEqual([]);
    expect(errors).toEqual([
      'Could not find a header row containing "FAN ID". Is this an FA Club Player Report?',
    ]);
  });

  it('names a missing required column', () => {
    const { errors } = parseImportSheet([['FAN ID', 'Age Group'], ['FAN001', 'U15']]);
    expect(errors).toEqual(['Required column not found: teamName']);
  });

  it('leaves an absent optional column blank rather than failing', () => {
    const { parsed, errors } = parseImportSheet([['FAN ID', 'Team'], ['FAN001', 'U15 Reds']]);
    expect(errors).toEqual([]);
    expect(parsed[0].ageGroup).toBe('');
    expect(parsed[0].registrationStatus).toBe('');
    expect(Object.keys(parsed[0])).toEqual(IMPORT_KEYS);
  });
});

describe('parseReportSheet', () => {
  it('pulls names and date of birth alongside the operational columns', () => {
    const { parsed, errors, warnings } = parseReportSheet(SHEET);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(parsed[0]).toMatchObject({
      fanId: 'FAN001',
      firstNames: 'Ada',
      surname: 'Lovelace',
      dateOfBirth: '04/11/2009',
      teamName: 'U15 Bantams Blue',
    });
  });

  it('accepts the alternative header spellings the FA exports use', () => {
    const { parsed, warnings } = parseReportSheet([
      ['FAN ID', 'Forenames', 'Last Name', 'DOB', 'Team'],
      ['FAN001', 'Ada', 'Lovelace', '04/11/2009', 'U15 Reds'],
    ]);
    expect(warnings).toEqual([]);
    expect(parsed[0]).toMatchObject({ firstNames: 'Ada', surname: 'Lovelace', dateOfBirth: '04/11/2009' });
  });

  it('warns rather than errors when a personal column is missing', () => {
    const { parsed, errors, warnings } = parseReportSheet([
      ['FAN ID', 'Surname', 'Team'],
      ['FAN001', 'Lovelace', 'U15 Reds'],
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'No "First names" column found — that column will be blank.',
      'No "Date of birth" column found — that column will be blank.',
    ]);
    expect(parsed[0].firstNames).toBe('');
    expect(parsed[0].dateOfBirth).toBe('');
    expect(parsed[0].surname).toBe('Lovelace');
  });

  it('formats an Excel serial date the same as a Date and a string', () => {
    const { parsed } = parseReportSheet(SHEET);
    // 40121 is the serial for 04/11/2009, the same day FAN001 arrives as a Date.
    expect(parsed[1].dateOfBirth).toBe(parsed[0].dateOfBirth);
    expect(parsed[1].dateOfBirth).toBe('04/11/2009');
  });
});

describe('formatCellDate', () => {
  it('renders Date objects, serials and strings identically', () => {
    expect(formatCellDate(new Date(2009, 10, 4))).toBe('04/11/2009');
    expect(formatCellDate(40121)).toBe('04/11/2009');
    expect(formatCellDate(' 04/11/2009 ')).toBe('04/11/2009');
  });

  it('returns an empty string for a blank cell', () => {
    expect(formatCellDate('')).toBe('');
    expect(formatCellDate(null)).toBe('');
    expect(formatCellDate(undefined)).toBe('');
  });

  // This output goes straight to D1, so reformatting here would rewrite stored values.
  it('passes an ISO string through unchanged', () => {
    expect(formatCellDate('2009-11-04')).toBe('2009-11-04');
  });
});

describe('formatReportDate', () => {
  it('rewrites an ISO string to UK order', () => {
    expect(formatReportDate('2009-11-04')).toBe('04/11/2009');
  });

  it('agrees with formatCellDate on every other shape', () => {
    for (const value of [new Date(2009, 10, 4), 40121, '04/11/2009', '']) {
      expect(formatReportDate(value)).toBe(formatCellDate(value));
    }
  });
});
