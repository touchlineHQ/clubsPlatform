import * as XLSX from 'xlsx';

/**
 * Parsing for the FA `Club - Player Report`: a row carries only the keys its
 * column spec asked for, so the import path cannot emit names or DOB (#94).
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

/** Field → its header texts, lowercased and tried in order; exports disagree on spelling. */
export type FaColumnSpec = Partial<Record<FaField, readonly string[]>>;

/** Exactly what the import posts and stores in D1 — never add name, DOB or contact columns. */
export const IMPORT_COLUMNS: FaColumnSpec = {
  fanId:              ['fan id'],
  ageGroup:           ['age group'],
  teamName:           ['team'],
  registrationExpiry: ['registration expiry'],
  registrationStatus: ['registration status'],
  playerEmail:        ['email address'],
  parentEmail:        ['parent/carer email address'],
};

/** The import columns plus the personal details the report keeps in browser memory. */
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

/** As `formatCellDate`, plus ISO → `dd/mm/yyyy`; the import path must not reformat. */
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

/** Find the header row by scanning for `FAN ID` — the export's title rows vary. */
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

  // Only FAN ID and Team are load-bearing; a missing optional column blanks its cells.
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

/** Field order in a parsed row; the first seven set the import payload's key order. */
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

/** One key per field in `spec`: absent columns are written empty, unasked-for fields not at all. */
function parseSheet(rows: unknown[][], spec: FaColumnSpec): ParseOutcome<Record<string, unknown>> {
  const { colIndex, headerRowIdx, errors, warnings } = locateColumns(rows, spec);
  if (errors.length) return { parsed: [], errors, warnings };

  const fields = FIELD_ORDER.filter(f => spec[f]);
  const parsed: Record<string, unknown>[] = [];

  for (const row of rows.slice(headerRowIdx + 1)) {
    // A blank FAN ID is a spacer or total row, not a player.
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

/** The same sheet with names and DOB attached; what it returns never leaves the browser. */
export function parseReportSheet(rows: unknown[][]): ParseOutcome<FaReportPlayerRow> {
  const { parsed, errors, warnings } = parseSheet(rows, REPORT_COLUMNS);
  return { parsed: parsed as unknown as FaReportPlayerRow[], errors, warnings };
}
