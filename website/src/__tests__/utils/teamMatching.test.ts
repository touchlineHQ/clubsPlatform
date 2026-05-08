import { describe, it, expect } from 'vitest';
import {
  teamBySlug,
  matchingTeamsByAge,
  liveTeamsForTeam,
  liveTeamsForSection,
  leagueQualifiedSlug,
  findDuplicateTeamNames,
  teamDisplayLabel,
} from '../../utils/teamMatching';
import type { LiveTeam, Team, TeamSection } from '../../types';

function live(slug: string, name = slug, league = 'test-league'): LiveTeam {
  return { slug, name, league };
}

function team(name: string, slug?: string): Team {
  return {
    name,
    slug,
    description: '',
    manager: '',
    coach: '',
    contact: '',
  };
}

function section(teams: Team[]): TeamSection {
  return { id: 's1', name: 'Section', subtitle: '', icon: 'users', teams };
}

// ─── teamBySlug ──────────────────────────────────────────────────────────────

describe('teamBySlug', () => {
  it('returns the live team on exact match', () => {
    const lt = live('under-13');
    expect(teamBySlug([lt], 'under-13')).toBe(lt);
  });

  it('normalises underscores to hyphens', () => {
    const lt = live('under-13');
    expect(teamBySlug([lt], 'under_13')).toBe(lt);
  });

  it('matches when the live slug is a suffix of the query', () => {
    const lt = live('u13');
    expect(teamBySlug([lt], 'club-prefix-u13')).toBe(lt);
  });

  it('matches when the query slug contains the live slug', () => {
    const lt = live('u13');
    expect(teamBySlug([lt], 'something-u13-youth')).toBe(lt);
  });

  it('returns null when there is no match', () => {
    expect(teamBySlug([live('u14')], 'u15')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(teamBySlug([], 'u13')).toBeNull();
  });
});

// ─── matchingTeamsByAge ───────────────────────────────────────────────────────

describe('matchingTeamsByAge', () => {
  const liveTeams = [
    live('club-u13'),
    live('club-under-14'),
    live('club-u13-girls'),
    live('seniors'),
  ];

  it('finds teams by "U13" name pattern', () => {
    const result = matchingTeamsByAge(liveTeams, 'U13');
    expect(result.map((t) => t.slug)).toContain('club-u13');
    expect(result.map((t) => t.slug)).toContain('club-u13-girls');
  });

  it('finds teams by "Under 14" name pattern', () => {
    const result = matchingTeamsByAge(liveTeams, 'Under 14');
    expect(result.map((t) => t.slug)).toContain('club-under-14');
  });

  it('finds teams by lowercase "u13" name pattern', () => {
    const result = matchingTeamsByAge(liveTeams, 'u13 Development');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty array when team name has no age component', () => {
    expect(matchingTeamsByAge(liveTeams, 'Seniors')).toHaveLength(0);
  });

  it('returns empty array when liveTeams is empty', () => {
    expect(matchingTeamsByAge([], 'U13')).toHaveLength(0);
  });
});

// ─── liveTeamsForTeam ────────────────────────────────────────────────────────

describe('liveTeamsForTeam', () => {
  it('returns an exact slug match immediately', () => {
    const lt = live('exact-slug');
    expect(liveTeamsForTeam(team('Any Name', 'exact-slug'), [lt])).toEqual([lt]);
  });

  it('falls back to normalised slug matching', () => {
    const lt = live('under-13');
    expect(liveTeamsForTeam(team('U13', 'under_13'), [lt])).toEqual([lt]);
  });

  it('falls back to name matching when slug does not match', () => {
    const lt = live('some-other-slug', 'Under 13s');
    expect(liveTeamsForTeam(team('Under 13s', 'no-match-slug'), [lt])).toEqual([lt]);
  });

  it('falls back to age matching when name also does not match', () => {
    const lt = live('club-u13');
    // slug and name won't match, but age extraction should catch it
    expect(liveTeamsForTeam(team('Under 13 Youth', 'xyz-nonexistent'), [lt])).toEqual([lt]);
  });

  it('uses age matching for teams without a slug', () => {
    const lt = live('club-u13');
    expect(liveTeamsForTeam(team('U13'), [lt])).toEqual([lt]);
  });

  it('returns empty array when nothing matches', () => {
    expect(liveTeamsForTeam(team('Seniors', 'seniors'), [live('u13')])).toHaveLength(0);
  });

  it('can return multiple live teams for one config team', () => {
    const lt1 = live('club-u13-sat');
    const lt2 = live('club-u13-sun');
    const result = liveTeamsForTeam(team('U13'), [lt1, lt2]);
    expect(result).toHaveLength(2);
  });
});

// ─── liveTeamsForSection ─────────────────────────────────────────────────────

describe('liveTeamsForSection', () => {
  it('aggregates live teams across all teams in the section', () => {
    const lt1 = live('club-u13');
    const lt2 = live('club-u14');
    const sec = section([team('U13'), team('U14')]);
    const result = liveTeamsForSection(sec, [lt1, lt2]);
    expect(result).toContain(lt1);
    expect(result).toContain(lt2);
  });

  it('returns empty array for a section with no teams', () => {
    expect(liveTeamsForSection(section([]), [live('u13')])).toHaveLength(0);
  });
});

// ─── leagueQualifiedSlug ─────────────────────────────────────────────────────

describe('leagueQualifiedSlug', () => {
  it('returns "league/slug"', () => {
    expect(leagueQualifiedSlug(live('u13', 'U13', 'yel-saturday'))).toBe('yel-saturday/u13');
  });
});

// ─── findDuplicateTeamNames ───────────────────────────────────────────────────

describe('findDuplicateTeamNames', () => {
  it('finds names that appear in more than one league', () => {
    const teams: LiveTeam[] = [
      live('u13-sat', 'U13', 'saturday-league'),
      live('u13-sun', 'U13', 'sunday-league'),
      live('u14', 'U14', 'saturday-league'),
    ];
    const dupes = findDuplicateTeamNames(teams);
    expect(dupes.has('U13')).toBe(true);
    expect(dupes.has('U14')).toBe(false);
  });

  it('does not flag the same name appearing in the same league', () => {
    const teams: LiveTeam[] = [
      live('u13-a', 'U13', 'same-league'),
      live('u13-b', 'U13', 'same-league'),
    ];
    expect(findDuplicateTeamNames(teams).has('U13')).toBe(false);
  });

  it('returns an empty set for an empty list', () => {
    expect(findDuplicateTeamNames([])).toEqual(new Set());
  });
});

// ─── teamDisplayLabel ────────────────────────────────────────────────────────

describe('teamDisplayLabel', () => {
  const dupes = new Set(['U13', 'U14']);

  it('returns plain name when not in duplicate set', () => {
    expect(teamDisplayLabel('Seniors', 'any-league', dupes)).toBe('Seniors');
  });

  it('appends "Saturday" suffix for saturday leagues', () => {
    expect(teamDisplayLabel('U13', 'yel-east-midlands-saturday-25-26', dupes)).toBe('U13 (Saturday)');
  });

  it('appends "Sunday" suffix for sunday leagues', () => {
    expect(teamDisplayLabel('U14', 'nfl-sunday-league', dupes)).toBe('U14 (Sunday)');
  });

  it('falls back to the league slug when day is unrecognised', () => {
    const label = teamDisplayLabel('U13', 'some-midweek-league', dupes);
    expect(label).toBe('U13 (some-midweek-league)');
  });
});
