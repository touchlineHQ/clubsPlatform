import { summariseRegistrations, type RegistrationSummary, type SummaryRow } from './registrationSummary';

/** What a team breakdown needs from a row, on top of the summary strip's fields. */
export interface TeamBreakdownRow extends SummaryRow {
  teamName: string;
  registrationStatus?: string | null;
  registrationExpiry?: string | null;
}

export interface TeamBreakdown extends RegistrationSummary {
  teamName: string;
  /** League-registered players (FA status Active or other non-training non-inactive). */
  league: number;
  /** Registrations whose FA status is "Training Only". */
  training: number;
  /** Registrations needing attention: expired registration or no level assigned. */
  issues: number;
}

/** FA statuses that count as a league-registered player. "Active" is the documented value;
 *  real exports have been seen with other spellings, so match a small set of likely ones.
 *  Anything that is neither training-only nor clearly inactive/cancelled is treated as league. */
const LEAGUE_STATUSES = new Set(['active', 'registered', 'full', 'full registration', 'playing', 'active registration']);
const TRAINING_STATUSES = new Set(['training only', 'training-only', 'training only.']);
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'lapsed', 'inactive', 'expired', 'deleted', 'not registered']);

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function isLeague(status: string | null | undefined): boolean {
  const n = norm(status);
  if (!n) return false;
  if (TRAINING_STATUSES.has(n) || INACTIVE_STATUSES.has(n)) return false;
  return LEAGUE_STATUSES.has(n) || true; // non-training, non-inactive → league
}

function isTraining(status: string | null | undefined): boolean {
  return TRAINING_STATUSES.has(norm(status));
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
 * One summary per team, sorted by name. `configuredTeams` (from /api/teams)
 * seeds zero rows for teams nobody has registered for yet.
 *
 * Money counts go through `summariseRegistrations` per team, so they match the
 * summary strip under a team filter: a billing group spanning teams counts once
 * in each team it has a member in.
 */
export function breakdownByTeam(
  rows: readonly TeamBreakdownRow[],
  now: number = Date.now(),
  configuredTeams: readonly string[] = [],
): TeamBreakdown[] {
  const byTeam = new Map<string, TeamBreakdownRow[]>();
  // Configured teams with nobody registered still get a row: that is the
  // clearest "space available" signal there is.
  for (const name of configuredTeams) {
    const trimmed = name.trim();
    if (trimmed && !byTeam.has(trimmed)) byTeam.set(trimmed, []);
  }
  for (const row of rows) {
    const name = row.teamName?.trim() || '(No team)';
    const list = byTeam.get(name);
    if (list) list.push(row); else byTeam.set(name, [row]);
  }

  return [...byTeam.entries()]
    .map(([teamName, teamRows]) => ({
      teamName,
      ...summariseRegistrations(teamRows),
      league: teamRows.filter(r => isLeague(r.registrationStatus)).length,
      training: teamRows.filter(r => isTraining(r.registrationStatus)).length,
      // Players = league-registered + training-only (the useful headcount). Distinct fanIds among those rows.
      players: new Set(teamRows.filter(r => isLeague(r.registrationStatus) || isTraining(r.registrationStatus)).map(r => r.fanId)).size,
      issues: teamRows.filter(r => hasIssue(r, now)).length,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { numeric: true, sensitivity: 'base' }));
}
