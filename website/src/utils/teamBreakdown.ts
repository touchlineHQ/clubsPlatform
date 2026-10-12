import { summariseRegistrations, type RegistrationSummary, type SummaryRow } from './registrationSummary';

/** What a team breakdown needs from a row, on top of the summary strip's fields. */
export interface TeamBreakdownRow extends SummaryRow {
  teamName: string;
  registrationStatus?: string | null;
  registrationExpiry?: string | null;
}

export interface TeamBreakdown extends RegistrationSummary {
  teamName: string;
  /** Registrations whose FA status is "Active" — a league-registered player. */
  league: number;
  /** Registrations whose FA status is "Training Only". */
  training: number;
  /** Registrations needing attention: expired registration or no level assigned. */
  issues: number;
}

const LEAGUE_STATUSES = new Set(['active']);
const TRAINING_STATUSES = new Set(['training only']);

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Parse an FA expiry (ISO `YYYY-MM-DD` or UK `DD/MM/YYYY`) to end of day UTC.
 * Mirrors functions/lib/send-guard.ts: blank means no constraint, malformed
 * means not current.
 */
export function isExpiryCurrent(raw: string | null | undefined, now: number = Date.now()): boolean {
  const s = (raw ?? '').trim();
  if (!s) return true;
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (uk) { d = +uk[1]; m = +uk[2]; y = +uk[3]; }
  else return false;
  const dt = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return dt.getTime() >= now;
}

function hasIssue(row: TeamBreakdownRow, now: number): boolean {
  const noLevel = !(row.subscriptionLevelId ?? row.overrideLevelId);
  return noLevel || !isExpiryCurrent(row.registrationExpiry, now);
}

/**
 * One summary per team, sorted by name.
 *
 * Money counts go through `summariseRegistrations` per team, so they match the
 * summary strip under a team filter: a billing group spanning teams counts once
 * in each team it has a member in.
 */
export function breakdownByTeam(rows: readonly TeamBreakdownRow[], now: number = Date.now()): TeamBreakdown[] {
  const byTeam = new Map<string, TeamBreakdownRow[]>();
  for (const row of rows) {
    const name = row.teamName?.trim() || '(No team)';
    const list = byTeam.get(name);
    if (list) list.push(row); else byTeam.set(name, [row]);
  }

  return [...byTeam.entries()]
    .map(([teamName, teamRows]) => ({
      teamName,
      ...summariseRegistrations(teamRows),
      league: teamRows.filter(r => LEAGUE_STATUSES.has(norm(r.registrationStatus))).length,
      training: teamRows.filter(r => TRAINING_STATUSES.has(norm(r.registrationStatus))).length,
      issues: teamRows.filter(r => hasIssue(r, now)).length,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { numeric: true, sensitivity: 'base' }));
}
