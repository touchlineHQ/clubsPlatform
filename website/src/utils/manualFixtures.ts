import type { ClubFeed, LiveFixture, LiveResult, ManualFixture } from '../types';

/** Same team, same day = same game. A team does not play twice in a day. */
function conflictKey(team: string, date: string): string {
  return `${team.trim().toLowerCase()}\0${date}`;
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Merge a club's manual fixtures and results into its feed (#78).
 *
 * - The feed wins: a manual entry for a team+date the feed already covers is
 *   dropped, so the game never renders twice.
 * - A manual entry takes the league of a same-named feed team, so the team
 *   filter shows one option per team rather than splitting feed and manual.
 * - With no manual entries the feed is returned untouched, so feed-driven
 *   clubs see no change.
 * - With no feed, manual entries alone produce a complete feed.
 */
export function mergeManualFixtures(
  feed: ClubFeed | null,
  manual: ManualFixture[],
  clubName: string,
  now: Date = new Date(),
): ClubFeed | null {
  if (manual.length === 0) return feed;

  const covered = new Set<string>();
  const leagueByTeam = new Map<string, string>();
  for (const f of [...(feed?.fixtures ?? []), ...(feed?.results ?? [])]) {
    covered.add(conflictKey(f.team, f.date));
    if (f.team && !leagueByTeam.has(f.team.trim().toLowerCase())) {
      leagueByTeam.set(f.team.trim().toLowerCase(), f.league);
    }
  }

  const today = todayIso(now);
  const fixtures: LiveFixture[] = [...(feed?.fixtures ?? [])];
  const results: LiveResult[] = [...(feed?.results ?? [])];

  manual.forEach((m, i) => {
    const played = m.homeScore !== null && m.awayScore !== null;
    // Past and unscored: nothing useful to show. Skip before claiming the
    // team+date key so it cannot hide a scored entry for the same game.
    if (!played && m.date < today) return;
    if (covered.has(conflictKey(m.team, m.date))) return;
    covered.add(conflictKey(m.team, m.date));
    const home = m.homeAway === 'home';
    const base: LiveFixture = {
      id: m.id ?? `manual-${i}`,
      date: m.date,
      time: m.time,
      home_team: home ? m.team : m.opponent,
      away_team: home ? m.opponent : m.team,
      venue: m.venue,
      division: m.competition,
      league: leagueByTeam.get(m.team.trim().toLowerCase()) ?? '',
      team: m.team,
      home_away: m.homeAway,
      opponent: m.opponent,
    };
    if (!played) {
      fixtures.push(base);
      return;
    }
    const gf = home ? m.homeScore : m.awayScore;
    const ga = home ? m.awayScore : m.homeScore;
    results.push({ ...base, home_score: m.homeScore, away_score: m.awayScore, goals_for: gf, goals_against: ga });
  });

  return {
    club: feed?.club ?? clubName,
    generated: feed?.generated ?? now.toISOString(),
    fixtures,
    results,
  };
}

export interface TableRow {
  team: string;
  league: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

/**
 * Derive a league table from recorded results: 3 points a win, 1 a draw,
 * sorted by points, goal difference, goals scored, then name. Results without
 * a score are skipped. Duplicate result ids (one game seen from two club
 * teams) count once.
 */
export function buildLeagueTable(results: LiveResult[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  // Keyed by name + league so same-named teams in different leagues stay apart.
  const row = (team: string, league: string): TableRow => {
    const key = `${team}\0${league}`;
    let r = rows.get(key);
    if (!r) {
      r = { team, league, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
      rows.set(key, r);
    }
    return r;
  };
  const seen = new Set<string>();
  for (const res of results) {
    if (res.home_score === null || res.away_score === null) continue;
    if (seen.has(res.id)) continue;
    seen.add(res.id);
    const h = row(res.home_team, res.league);
    const a = row(res.away_team, res.league);
    h.played++; a.played++;
    h.goalsFor += res.home_score; h.goalsAgainst += res.away_score;
    a.goalsFor += res.away_score; a.goalsAgainst += res.home_score;
    if (res.home_score > res.away_score) { h.won++; a.lost++; h.points += 3; }
    else if (res.home_score < res.away_score) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  for (const r of rows.values()) r.goalDifference = r.goalsFor - r.goalsAgainst;
  return [...rows.values()].sort((x, y) =>
    y.points - x.points
    || y.goalDifference - x.goalDifference
    || y.goalsFor - x.goalsFor
    || x.team.localeCompare(y.team));
}

export interface CompetitionTable {
  competition: string;
  rows: TableRow[];
}

/**
 * One table per competition (division), so a friendly or cup game never
 * lands in the same table as league games. Callers pass one team's results.
 */
export function buildCompetitionTables(results: LiveResult[]): CompetitionTable[] {
  const byCompetition = new Map<string, LiveResult[]>();
  for (const r of results) {
    const key = r.division.trim() || 'Other games';
    const list = byCompetition.get(key) ?? [];
    list.push(r);
    byCompetition.set(key, list);
  }
  return [...byCompetition.entries()]
    .map(([competition, list]) => ({ competition, rows: buildLeagueTable(list) }))
    .filter((t) => t.rows.length > 0)
    .sort((a, b) => a.competition.localeCompare(b.competition));
}

export type ManualFixtureField = 'team' | 'opponent' | 'date' | 'time' | 'homeScore' | 'awayScore';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validScore(v: number | null): boolean {
  return v === null || (Number.isInteger(v) && v >= 0 && v <= 99);
}

/**
 * Client-side mirror of the /api/fixtures validation, per field, so the form
 * can point at the bad game and Save can refuse to start rather than half-save.
 */
export function manualFixtureErrors(list: ManualFixture[]): Partial<Record<ManualFixtureField, string>>[] {
  const firstIndex = new Map<string, number>();
  return list.map((m, i) => {
    const e: Partial<Record<ManualFixtureField, string>> = {};
    const team = m.team.trim();
    const opponent = m.opponent.trim();
    if (!team) e.team = 'Required';
    if (!opponent) e.opponent = 'Required';
    else if (team && opponent.toLowerCase() === team.toLowerCase()) e.opponent = 'Cannot be the same as our team';
    const parsed = DATE_RE.test(m.date) ? new Date(`${m.date}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== m.date) e.date = 'Enter a valid date';
    if (m.time && !TIME_RE.test(m.time)) e.time = 'Use HH:MM';
    if (!validScore(m.homeScore)) e.homeScore = 'Whole number 0-99';
    if (!validScore(m.awayScore)) e.awayScore = 'Whole number 0-99';
    if (!e.homeScore && !e.awayScore && (m.homeScore === null) !== (m.awayScore === null)) {
      e[m.homeScore === null ? 'homeScore' : 'awayScore'] = 'Enter both scores or neither';
    }
    if (team && !e.date) {
      const key = `${team.toLowerCase()}\0${m.date}`;
      const first = firstIndex.get(key);
      if (first === undefined) firstIndex.set(key, i);
      else e.date = `${team} already has a game on this date (game ${first + 1})`;
    }
    return e;
  });
}

export function hasManualFixtureErrors(list: ManualFixture[]): boolean {
  return manualFixtureErrors(list).some((e) => Object.keys(e).length > 0);
}
