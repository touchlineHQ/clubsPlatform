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
    const played = m.homeScore !== null && m.awayScore !== null;
    if (!played && m.date >= today) {
      fixtures.push(base);
      return;
    }
    if (!played) return; // past and unscored: nothing useful to show
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
  const row = (team: string): TableRow => {
    let r = rows.get(team);
    if (!r) {
      r = { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
      rows.set(team, r);
    }
    return r;
  };
  const seen = new Set<string>();
  for (const res of results) {
    if (res.home_score === null || res.away_score === null) continue;
    if (seen.has(res.id)) continue;
    seen.add(res.id);
    const h = row(res.home_team);
    const a = row(res.away_team);
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
