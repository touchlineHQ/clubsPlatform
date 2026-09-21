import { getSubscriptionStatus } from './subscriptionStatus';

/**
 * Join an FA Club Player Report against the club's own registrations.
 *
 * Pure: no React, no XLSX, no `window`. The caller supplies the rows and a
 * payment-link builder, and gets back the sheet's rows.
 *
 * This replaces a hand-rolled Google Sheets merge that keyed on FAN ID alone.
 * That collapsed multi-team players — a U18 who also played for the first team
 * vanished from the U18 count — and could show one team's subscription status
 * against another team's row. Keying on FAN ID *and* team fixes both.
 */

export type MatchKind = 'Matched' | 'No subs record' | 'Subs only';

/**
 * Structural, so the page's `RegistrationRow` satisfies it without this module
 * importing a page type.
 */
export interface StatusReportRegistration {
  fanId: string;
  teamName: string;
  registrationStatus?: string | null;
  registrationExpiry?: string | null;
  subscriptionLevelName?: string | null;
  paymentStatus?: string | null;
  manualPaidBy?: string | null;
}

/** A row from the FA report, as `parseReportSheet` returns it. */
export interface StatusReportFaRow {
  fanId: string;
  teamName: string;
  firstNames?: string;
  surname?: string;
  dateOfBirth?: string;
  ageGroup?: string;
  registrationStatus?: string;
  registrationExpiry?: string;
}

/** One output row. Every field is a string; blanks are `''`, never null. */
export interface StatusReportRow {
  match: MatchKind;
  fanId: string;
  team: string;
  firstNames: string;
  surname: string;
  dateOfBirth: string;
  ageGroup: string;
  registrationStatus: string;
  registrationExpiry: string;
  subscriptionLevel: string;
  subscriptionStatus: string;
  markedPaidBy: string;
  paymentLink: string;
}

/**
 * The page's active filters, as they apply to FA rows with no registration.
 *
 * Registrations arrive already filtered by the page; FA-only rows have to be
 * filtered here or the report would show players the table is hiding.
 */
export interface FaRowFilter {
  team?: string | null;
  registrationStatus?: string | null;
  /**
   * Drop FA-only rows entirely. Set when a subscription filter is active: a
   * player with no registration has no subscription status and so cannot
   * satisfy such a filter either way.
   */
  dropFaOnly?: boolean;
}

export interface StatusReportOptions {
  /** Include FA rows marked Cancelled or Transferred. Default false. */
  includeCancelled?: boolean;
  faFilter?: FaRowFilter;
  /** Injected so this module needs neither `window` nor the club slug. */
  paymentLink?: (fanId: string) => string;
}

/** FA registration statuses left out of the report unless asked for. */
export const EXCLUDED_FA_STATUSES: readonly string[] = ['cancelled', 'transferred'];

/**
 * Collapse a team name to its comparable form.
 *
 * The internal whitespace collapse is load-bearing: `East Leake FC U15 Bantams
 * ␣␣Blue` carries a double space in both exports today, which is luck rather
 * than contract.
 */
export function normaliseTeam(team: string): string {
  return team.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The join key. FAN ID alone is never enough — see the module comment. */
export function joinKey(fanId: string, team: string): string {
  return `${fanId.trim()}|${normaliseTeam(team)}`;
}

/** Empty-last, case- and number-aware comparison, as the club table sorts. */
function compare(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const text = (value: string | null | undefined): string => value ?? '';

/** Whether an FA row survives the exclusion rule and the page's filters. */
function faRowIncluded(
  row: StatusReportFaRow,
  { includeCancelled, faFilter }: StatusReportOptions,
): boolean {
  if (!includeCancelled && EXCLUDED_FA_STATUSES.includes(text(row.registrationStatus).trim().toLowerCase())) {
    return false;
  }
  if (faFilter?.team && normaliseTeam(row.teamName) !== normaliseTeam(faFilter.team)) return false;
  if (faFilter?.registrationStatus && text(row.registrationStatus) !== faFilter.registrationStatus) {
    return false;
  }
  return true;
}

/**
 * Build the report rows.
 *
 * Registration-driven: every registration handed in produces exactly one row,
 * so nothing the club holds can be silently dropped. FA rows left over at the
 * end become the `No subs record` chase list.
 */
export function buildStatusReport(
  faRows: StatusReportFaRow[],
  registrations: StatusReportRegistration[],
  options: StatusReportOptions = {},
): StatusReportRow[] {
  const link = options.paymentLink ?? (() => '');

  // First FA row wins on a duplicate key — that is the manual "strip duplicate
  // registrations" step this report replaces.
  const faByKey = new Map<string, StatusReportFaRow>();
  for (const row of faRows) {
    if (!faRowIncluded(row, options)) continue;
    const key = joinKey(row.fanId, row.teamName);
    if (!faByKey.has(key)) faByKey.set(key, row);
  }

  const consumed = new Set<string>();
  const out: StatusReportRow[] = [];

  for (const reg of registrations) {
    const key = joinKey(reg.fanId, reg.teamName);
    const fa = faByKey.get(key);
    if (fa) consumed.add(key);

    out.push({
      match: fa ? 'Matched' : 'Subs only',
      fanId: reg.fanId,
      team: reg.teamName,
      firstNames: text(fa?.firstNames),
      surname: text(fa?.surname),
      dateOfBirth: text(fa?.dateOfBirth),
      ageGroup: text(fa?.ageGroup),
      // The FA file is the fresher source. Its expiry is already dd/mm/yyyy;
      // the stored one is left exactly as it is, because an ambiguous
      // 03/04/2026 cannot be safely re-parsed into a known order.
      registrationStatus: text(fa?.registrationStatus) || text(reg.registrationStatus),
      registrationExpiry: text(fa?.registrationExpiry) || text(reg.registrationExpiry),
      subscriptionLevel: text(reg.subscriptionLevelName),
      subscriptionStatus: getSubscriptionStatus(reg).label,
      markedPaidBy: text(reg.manualPaidBy),
      paymentLink: link(reg.fanId),
    });
  }

  if (!options.faFilter?.dropFaOnly) {
    for (const [key, fa] of faByKey) {
      if (consumed.has(key)) continue;
      out.push({
        match: 'No subs record',
        fanId: fa.fanId,
        team: fa.teamName,
        firstNames: text(fa.firstNames),
        surname: text(fa.surname),
        dateOfBirth: text(fa.dateOfBirth),
        ageGroup: text(fa.ageGroup),
        registrationStatus: text(fa.registrationStatus),
        registrationExpiry: text(fa.registrationExpiry),
        // No registration means no level, no status and nobody marked it paid.
        subscriptionLevel: '',
        subscriptionStatus: '',
        markedPaidBy: '',
        // The link still matters: this is who the treasurer has to chase.
        paymentLink: link(fa.fanId),
      });
    }
  }

  return out.sort((a, b) =>
    compare(a.team, b.team) || compare(a.surname, b.surname) || compare(a.fanId, b.fanId));
}

/** Counts for the on-screen preview and the analytics event. */
export function summariseStatusReport(rows: StatusReportRow[]): {
  rowCount: number;
  matched: number;
  noSubsRecord: number;
  subsOnly: number;
} {
  return {
    rowCount: rows.length,
    matched: rows.filter(r => r.match === 'Matched').length,
    noSubsRecord: rows.filter(r => r.match === 'No subs record').length,
    subsOnly: rows.filter(r => r.match === 'Subs only').length,
  };
}

/**
 * The worksheet's columns, in order. Single source for the output contract:
 * header text, which field fills it, and how wide to make it.
 *
 * `Match` comes first — it is what the report is for.
 */
export const STATUS_REPORT_COLUMNS: readonly {
  header: string;
  key: keyof StatusReportRow;
  wch: number;
}[] = [
  { header: 'Match',               key: 'match',              wch: 16 },
  { header: 'FAN ID',              key: 'fanId',              wch: 12 },
  { header: 'Team',                key: 'team',               wch: 28 },
  { header: 'First names',         key: 'firstNames',         wch: 18 },
  { header: 'Surname',             key: 'surname',            wch: 18 },
  { header: 'Date of birth',       key: 'dateOfBirth',        wch: 14 },
  { header: 'Age group',           key: 'ageGroup',           wch: 12 },
  { header: 'Registration status', key: 'registrationStatus', wch: 18 },
  { header: 'Registration expiry', key: 'registrationExpiry', wch: 18 },
  { header: 'Subscription level',  key: 'subscriptionLevel',  wch: 22 },
  { header: 'Subscription status', key: 'subscriptionStatus', wch: 18 },
  { header: 'Marked paid by',      key: 'markedPaidBy',       wch: 28 },
  { header: 'Payment link',        key: 'paymentLink',        wch: 60 },
];

/** Header-keyed records for `XLSX.utils.json_to_sheet`, in column order. */
export function toSheetRows(rows: StatusReportRow[]): Record<string, string>[] {
  return rows.map(row => {
    const out: Record<string, string> = {};
    for (const { header, key } of STATUS_REPORT_COLUMNS) out[header] = row[key];
    return out;
  });
}
