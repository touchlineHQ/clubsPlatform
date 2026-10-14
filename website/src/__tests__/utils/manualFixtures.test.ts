import { describe, it, expect } from 'vitest';
import { mergeManualFixtures, buildLeagueTable, buildCompetitionTables, manualFixtureErrors, hasManualFixtureErrors } from '../../utils/manualFixtures';
import type { ClubFeed, LiveResult, ManualFixture } from '../../types';

const NOW = new Date('2026-10-14T09:00:00Z');

const manual = (over: Partial<ManualFixture> = {}): ManualFixture => ({
  team: 'U12 Reds', date: '2026-11-07', time: '10:00', homeAway: 'home', opponent: 'Rivals',
  venue: 'Main', competition: 'Friendly', homeScore: null, awayScore: null, ...over,
});

const feed: ClubFeed = {
  club: 'Test FC',
  generated: '2026-10-01T00:00:00Z',
  fixtures: [{
    id: 'f1', date: '2026-11-07', time: '10:30', home_team: 'U12 Reds', away_team: 'League Opp', venue: 'Main',
    division: 'U12 D1', league: 'jpl', team: 'U12 Reds', home_away: 'home', opponent: 'League Opp',
  }],
  results: [],
};

describe('mergeManualFixtures', () => {
  it('returns the feed untouched when there are no manual entries', () => {
    expect(mergeManualFixtures(feed, [], 'Test FC', NOW)).toBe(feed);
    expect(mergeManualFixtures(null, [], 'Test FC', NOW)).toBeNull();
  });

  it('builds a complete feed from manual entries when the club has no feed', () => {
    const merged = mergeManualFixtures(null, [
      manual(),
      manual({ date: '2026-10-03', homeAway: 'away', homeScore: 2, awayScore: 4 }),
    ], 'Test FC', NOW)!;
    expect(merged.club).toBe('Test FC');
    expect(merged.fixtures).toHaveLength(1);
    expect(merged.fixtures[0]).toMatchObject({ home_team: 'U12 Reds', away_team: 'Rivals', home_away: 'home' });
    expect(merged.results).toHaveLength(1);
    expect(merged.results[0]).toMatchObject({ home_team: 'Rivals', away_team: 'U12 Reds', goals_for: 4, goals_against: 2 });
  });

  it('drops a manual entry the feed already covers (same team, same day, case-insensitive)', () => {
    const merged = mergeManualFixtures(feed, [manual({ team: 'u12 reds ' })], 'Test FC', NOW)!;
    expect(merged.fixtures).toHaveLength(1);
    expect(merged.fixtures[0].id).toBe('f1');
  });

  it('adds non-conflicting entries and borrows the feed league for the same team', () => {
    const merged = mergeManualFixtures(feed, [manual({ date: '2026-11-21', id: 'm1' })], 'Test FC', NOW)!;
    expect(merged.fixtures.map(f => f.id)).toEqual(['f1', 'm1']);
    expect(merged.fixtures[1].league).toBe('jpl');
    expect(merged.generated).toBe(feed.generated);
  });

  it('does not let a skipped past unscored entry hide a scored one for the same game', () => {
    const merged = mergeManualFixtures(null, [
      manual({ date: '2026-09-01' }),
      manual({ date: '2026-09-01', homeScore: 1, awayScore: 0 }),
    ], 'Test FC', NOW)!;
    expect(merged.results).toHaveLength(1);
  });

  it('skips past games with no score and de-duplicates repeated manual entries', () => {
    const merged = mergeManualFixtures(null, [
      manual({ date: '2026-09-01' }),
      manual({ date: '2026-12-01' }),
      manual({ date: '2026-12-01', opponent: 'Dup' }),
    ], 'Test FC', NOW)!;
    expect(merged.fixtures).toHaveLength(1);
    expect(merged.results).toHaveLength(0);
  });
});

const result = (id: string, home: string, away: string, hs: number | null, as: number | null): LiveResult => ({
  id, date: '2026-10-01', time: '', home_team: home, away_team: away, venue: '', division: '', league: '',
  team: home, home_away: 'home', opponent: away, home_score: hs, away_score: as, goals_for: hs, goals_against: as,
});

describe('buildLeagueTable', () => {
  it('derives P/W/D/L, goals and points, sorted by points then GD then GF', () => {
    const table = buildLeagueTable([
      result('1', 'Reds', 'Blues', 3, 1),
      result('2', 'Greens', 'Reds', 0, 0),
      result('3', 'Blues', 'Greens', 2, 0),
      result('3', 'Blues', 'Greens', 2, 0), // same game seen twice
      result('4', 'Reds', 'Yellows', null, null), // unscored
    ]);
    expect(table.map(r => r.team)).toEqual(['Reds', 'Blues', 'Greens']);
    expect(table[0]).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, points: 4 });
    expect(table[1]).toMatchObject({ played: 2, won: 1, lost: 1, points: 3, goalDifference: 0 });
    expect(table[2]).toMatchObject({ played: 2, drawn: 1, lost: 1, points: 1, goalDifference: -2 });
  });

  it('breaks ties on goals scored, then name', () => {
    const table = buildLeagueTable([result('1', 'B', 'A', 2, 2), result('2', 'C', 'D', 1, 1)]);
    expect(table.map(r => r.team)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is empty with no scored results', () => {
    expect(buildLeagueTable([])).toEqual([]);
  });
});

describe('buildLeagueTable league identity', () => {
  it('keeps same-named teams in different leagues apart', () => {
    const a = { ...result('1', 'Reds', 'Blues', 1, 0), league: 'sat' };
    const b = { ...result('2', 'Reds', 'Greens', 0, 2), league: 'sun' };
    const table = buildLeagueTable([a, b]);
    expect(table.filter(r => r.team === 'Reds').map(r => [r.league, r.points])).toEqual([['sat', 3], ['sun', 0]]);
  });
});

describe('buildCompetitionTables', () => {
  it('splits by division and names blanks "Other games"', () => {
    const tables = buildCompetitionTables([
      { ...result('1', 'Reds', 'Blues', 1, 0), division: 'Cup' },
      { ...result('2', 'Reds', 'Greens', 0, 0), division: '' },
      { ...result('3', 'Reds', 'Yellows', null, null), division: 'Friendly' },
    ]);
    expect(tables.map(t => t.competition)).toEqual(['Cup', 'Other games']);
    expect(tables[0].rows[0]).toMatchObject({ team: 'Reds', points: 3 });
  });
});

describe('manualFixtureErrors', () => {
  it('passes a valid entry', () => {
    expect(manualFixtureErrors([manual()])).toEqual([{}]);
    expect(hasManualFixtureErrors([manual(), manual({ date: '2026-11-08', homeScore: 2, awayScore: 2 })])).toBe(false);
  });

  it('flags each invalid field', () => {
    expect(manualFixtureErrors([manual({ team: ' ', opponent: '' })])[0]).toMatchObject({ team: 'Required', opponent: 'Required' });
    expect(manualFixtureErrors([manual({ opponent: 'u12 reds' })])[0].opponent).toMatch(/same/);
    expect(manualFixtureErrors([manual({ date: '2026-02-30' })])[0].date).toMatch(/valid date/);
    expect(manualFixtureErrors([manual({ time: '9am' })])[0].time).toMatch(/HH:MM/);
    expect(manualFixtureErrors([manual({ homeScore: 100, awayScore: 1 })])[0].homeScore).toMatch(/0-99/);
    expect(manualFixtureErrors([manual({ homeScore: NaN, awayScore: 1 })])[0].homeScore).toMatch(/0-99/);
    expect(manualFixtureErrors([manual({ homeScore: 2 })])[0].awayScore).toMatch(/both/);
    expect(manualFixtureErrors([manual({ awayScore: 2 })])[0].homeScore).toMatch(/both/);
  });

  it('flags a second game for the same team on the same day', () => {
    const errs = manualFixtureErrors([manual(), manual({ team: 'U12 REDS', opponent: 'Other' })]);
    expect(errs[0]).toEqual({});
    expect(errs[1].date).toMatch(/game 1/);
  });
});
