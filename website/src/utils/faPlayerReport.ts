import * as XLSX from 'xlsx';

/**
 * Parsing for the FA's `Club - Player Report` workbook.
 *
 * Two callers, two column sets. The player import reads the operational
 * columns and posts them to the server; the status report additionally reads
 * names and date of birth, which must never leave the browser (issue #94).
 *
 * The opt-in `FaColumnSpec` is what keeps those apart. A parsed row only ever
 * carries keys that were present in the spec handed to the parser, so the
 * import path is structurally incapable of emitting a name or DOB field —
 * there is no code path that writes one.
 */

export type FaField =
  | 'fanId'
  | 'ageGroup'
  | 'teamName'
  | 'registrationExpiry'
  | 'registrationStatus'
  | 'playerEmail'
  | 'parentEmail'
  | 'firstNames'
  | 'surname'
  | 'dateOfBirth';

/**
 * Field → the header texts that identify it, lowercased and trimmed, tried in
 * order. The FA has renamed columns before and different exports disagree on
 * "First Names" vs "Forename", so a field may list several spellings.
 */
export type FaColumnSpec = Partial<Record<FaField, readonly string[]>>;

/**
 * Exactly the columns the player import has always read.
 *
 * Do not add name, DOB, gender or contact columns here: everything in this
 * spec is posted to `/api/admin/import-players` and stored in D1.
 */
export const IMPORT_COLUMNS: FaColumnSpec = {
  fanId:              ['fan id'],
  ageGroup:           ['age group'],
  teamName:           ['team'],
  registrationExpiry: ['registration expiry'],
  registrationStatus: ['registration status'],
  playerEmail:        ['email address'],
  parentEmail:        ['parent/carer email address'],
};

/**
 * The import columns plus the personal details the status report needs.
 *
 * Rows parsed with this spec stay in browser memory for the lifetime of the
 * export. They are never posted, persisted or sent to analytics.
 */
export const REPORT_COLUMNS: FaColumnSpec = {
  ...IMPORT_COLUMNS,
  firstNames:  ['first names', 'first name', 'forename', 'forenames'],
  surname:     ['surname', 'last name', 'family name'],
  dateOfBirth: ['date of birth', 'dob', 'd.o.b.'],
};

/** Human-readable column names, for the warning shown when one is missing. */
const FIELD_LABELS: Partial<Record<FaField, string>> = {
  firstNames:  'First names',
  surname:     'Surname',
  dateOfBirth: 'Date of birth',
};

/** A player row as the import posts it. Seven keys, in this order. */
export interface ParsedPlayerRow {
  fanId: string;
  ageGroup: string;
  teamName: string;
  registrationExpiry: string;
  registrationStatus: string;
  playerEmail: string;
  parentEmails: string[];
}

/** An import row plus the personal details. Report only — never posted. */
export interface FaReportPlayerRow extends ParsedPlayerRow {
  firstNames: string;
  surname: string;
  dateOfBirth: string;
}

/** A workbook cell rendered as `dd/mm/yyyy`, whatever shape it arrived in. */
export function formatCellDate(value: unknown): string {
  if (!value && value !== 0) return '';
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
  }
  return String(value).trim();
}

/**
 * As `formatCellDate`, but also rewrites an ISO date to `dd/mm/yyyy`.
 *
 * Report only. `formatCellDate` passes strings through untouched because its
 * output is what the import writes to D1, and changing that would change the
 * stored values; the report has no such constraint and the spreadsheet is read
 * by people who expect UK dates.
 */
export function formatReportDate(value: unknown): string {
  const formatted = formatCellDate(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(formatted);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : formatted;
}

/** Read the first sheet of a workbook as an array of raw cell rows. */
export function readWorkbookRows(data: unknown): unknown[][] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
}

/** Where each requested field sits in the header row; absent when not found. */
type ColIndex = Partial<Record<FaField, number>>;

interface ParseOutcome<T> {
  parsed: T[];
  errors: string[];
  /** Optional columns that were not found; the report surfaces these. */
  warnings: string[];
}

/** Trimmed, lowercased text for a cell that may be any type or missing. */
const cellText = (value: unknown): string => String(value ?? '').trim();

/**
 * Locate the requested columns and read every data row beneath them.
 *
 * The header row is found by scanning for a `FAN ID` cell rather than assuming
 * a fixed row: the FA export carries a variable number of title rows above it.
 */
function locateColumns(
  rows: unknown[][],
  spec: FaColumnSpec,
): { colIndex: ColIndex; headerRowIdx: number; errors: string[]; warnings: string[] } {
  const headerRowIdx = rows.findIndex(r =>
    r.some(cell => cellText(cell).toLowerCase() === 'fan id')
  );
  if (headerRowIdx === -1) {
    return {
      colIndex: {},
      headerRowIdx,
      errors: ['Could not find a header row containing "FAN ID". Is this an FA Club Player Report?'],
      warnings: [],
    };
  }

  const headerRow = rows[headerRowIdx].map(c => cellText(c).toLowerCase());
  const colIndex: ColIndex = {};
  for (const [field, headerTexts] of Object.entries(spec) as [FaField, readonly string[]][]) {
    for (const headerText of headerTexts) {
      const idx = headerRow.indexOf(headerText);
      if (idx !== -1) {
        colIndex[field] = idx;
        break;
      }
    }
  }

  // Only FAN ID and Team are load-bearing. A missing optional column leaves its
  // cells blank rather than refusing the file, which matters most for the
  // report: the unmatched-player chase list is useful even without names.
  const errors: string[] = [];
  for (const field of ['fanId', 'teamName'] as const) {
    if (colIndex[field] === undefined) errors.push(`Required column not found: ${field}`);
  }

  const warnings: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS) as [FaField, string][]) {
    if (spec[field] && colIndex[field] === undefined) {
      warnings.push(`No "${label}" column found — that column will be blank.`);
    }
  }

  return { colIndex, headerRowIdx, errors, warnings };
}

/**
 * The order fields appear in a parsed row.
 *
 * The import payload's key order comes from here, so keep the first seven as
 * they are: changing them changes the JSON posted to the server.
 */
const FIELD_ORDER: readonly FaField[] = [
  'fanId', 'ageGroup', 'teamName', 'registrationExpiry', 'registrationStatus',
  'playerEmail', 'parentEmail', 'firstNames', 'surname', 'dateOfBirth',
];

/** The row key a field is written under; only `parentEmail` differs. */
const ROW_KEY: Partial<Record<FaField, string>> = { parentEmail: 'parentEmails' };

/** Read one field from a row, applying that field's own coercion. */
function readField(row: unknown[], colIndex: ColIndex, name: FaField): unknown {
  const raw = row[colIndex[name] ?? -1];
  switch (name) {
    case 'parentEmail': {
      const text = cellText(raw);
      return text ? text.split(',').map(e => e.trim()).filter(Boolean) : [];
    }
    case 'playerEmail':        return cellText(raw).toLowerCase();
    case 'registrationExpiry': return formatCellDate(raw);
    case 'dateOfBirth':        return formatReportDate(raw);
    default:                   return cellText(raw);
  }
}

/**
 * Parse every data row into an object carrying one key per field in `spec`.
 *
 * A field the spec asks for but the file lacks is still written, empty — that
 * is what keeps the import payload's shape constant. A field the spec does not
 * ask for is never written at all, which is the no-PII guarantee.
 */
function parseSheet(rows: unknown[][], spec: FaColumnSpec): ParseOutcome<Record<string, unknown>> {
  const { colIndex, headerRowIdx, errors, warnings } = locateColumns(rows, spec);
  if (errors.length) return { parsed: [], errors, warnings };

  const fields = FIELD_ORDER.filter(f => spec[f]);
  const parsed: Record<string, unknown>[] = [];

  for (const row of rows.slice(headerRowIdx + 1)) {
    // A blank FAN ID means a spacer or total row, not a player.
    if (!cellText(row[colIndex.fanId ?? -1])) continue;

    const out: Record<string, unknown> = {};
    for (const name of fields) out[ROW_KEY[name] ?? name] = readField(row, colIndex, name);
    parsed.push(out);
  }

  return { parsed, errors, warnings };
}

/** Parse the operational columns the player import posts. */
export function parseImportSheet(rows: unknown[][]): { parsed: ParsedPlayerRow[]; errors: string[] } {
  const { parsed, errors } = parseSheet(rows, IMPORT_COLUMNS);
  return { parsed: parsed as unknown as ParsedPlayerRow[], errors };
}

/**
 * Parse the same sheet with names and date of birth attached.
 *
 * Only the status report calls this, and what it returns never leaves the
 * browser.
 */
export function parseReportSheet(rows: unknown[][]): ParseOutcome<FaReportPlayerRow> {
  const { parsed, errors, warnings } = parseSheet(rows, REPORT_COLUMNS);
  return { parsed: parsed as unknown as FaReportPlayerRow[], errors, warnings };
}
