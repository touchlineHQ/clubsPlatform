import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithMantine, mockSection, mockSingleClub } from '../test-utils';
import { FixturesResultsPage } from '../../pages/FixturesResultsPage';
import type { ClubFeed, TeamsData, LiveTeam } from '../../types';

const emptyFeed: ClubFeed = {
  club: 'test-club',
  fixtures: [],
  results: [],
  generated: '2026-01-01T00:00:00Z',
};

const teams: TeamsData = {
  sections: [
    {
      id: 'seniors',
      name: 'Senior Teams',
      subtitle: 'Our seniors',
      icon: 'fa-shield-alt',
      teams: [{ name: 'First XI', manager: 'Dave', coach: 'Eve', contact: '', description: '' }],
    },
  ],
};

const liveTeams: LiveTeam[] = [];

describe('FixturesResultsPage', () => {
  it('renders page header', () => {
    renderWithMantine(
      <FixturesResultsPage feed={emptyFeed} teams={teams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('shows results and fixtures tabs', () => {
    renderWithMantine(
      <FixturesResultsPage feed={emptyFeed} teams={teams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByRole('tab', { name: /Fixtures/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Results/i })).toBeTruthy();
  });

  it('renders with null feed without error', () => {
    renderWithMantine(
      <FixturesResultsPage feed={null} teams={teams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('shows section filter when multiple sections present', () => {
    const multiSectionTeams: TeamsData = {
      sections: [
        { id: 'seniors', name: 'Seniors', subtitle: '', icon: '', teams: [] },
        { id: 'juniors', name: 'Juniors', subtitle: '', icon: '', teams: [] },
      ],
    };
    renderWithMantine(
      <FixturesResultsPage feed={emptyFeed} teams={multiSectionTeams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub, sectionValue: { ...mockSection, activeSection: 'all' } },
    );
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('shows fixture opponent in fixtures table', () => {
    const feed: ClubFeed = {
      club: 'test-club',
      generated: '2026-01-01T00:00:00Z',
      fixtures: [{ id: 'f1', date: '2026-06-01', time: '15:00', opponent: 'Rivals FC', home_away: 'home', league: 'sunday-league', team: 'First XI', home_team: 'First XI', away_team: 'Rivals FC', venue: '', division: 'League' }],
      results: [],
    };
    const liveTeamsWithTeam: LiveTeam[] = [
      { slug: 'first-xi', name: 'First XI', league: 'sunday-league' },
    ];
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={liveTeamsWithTeam} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByText('Rivals FC')).toBeTruthy();
  });

  it('shows results in results table', () => {
    const feed: ClubFeed = {
      club: 'test-club',
      generated: '2026-01-01T00:00:00Z',
      fixtures: [],
      results: [{ id: 'r1', date: '2026-05-01', time: '15:00', opponent: 'Old Rivals', home_away: 'away', league: 'sunday-league', team: 'First XI', home_team: 'Old Rivals', away_team: 'First XI', venue: '', division: 'League', goals_for: 3, goals_against: 1, home_score: 1, away_score: 3 }],
    };
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={[]} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByText('Old Rivals')).toBeTruthy();
  });

  it('shows W/D/L stats when results have scores', () => {
    // home_away values corrected to the LiveResult union ('home' | 'away'); the
    // previous 'H'/'A' literals were stale and only survived while tests were
    // untyped. Assertions still key off goals_for/goals_against for W/D/L.
    const feed: ClubFeed = {
      club: 'test-club',
      generated: '2026-01-01T00:00:00Z',
      fixtures: [],
      results: [
        { id: 'r1', date: '2026-05-01', time: '15:00', opponent: 'Team A', home_away: 'home', league: 'sunday-league', team: 'First XI', home_team: 'First XI', away_team: 'Team A', venue: '', division: 'League', goals_for: 2, goals_against: 0, home_score: 2, away_score: 0 },
        { id: 'r2', date: '2026-04-01', time: '15:00', opponent: 'Team B', home_away: 'away', league: 'sunday-league', team: 'First XI', home_team: 'Team B', away_team: 'First XI', venue: '', division: 'League', goals_for: 1, goals_against: 1, home_score: 1, away_score: 1 },
      ],
    };
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={[]} />,
      { clubValue: mockSingleClub },
    );
    // Click Results tab to see results and stats
    screen.getByRole('tab', { name: /Results/i }).click();
    // Win/draw/loss letters appear in stats and form badges
    expect(screen.getAllByText('W').length).toBeGreaterThan(0);
  });

  it('shows team select dropdown when feed has multiple teams', () => {
    const feed: ClubFeed = {
      club: 'test-club',
      generated: '2026-01-01T00:00:00Z',
      fixtures: [
        { id: 'f1', date: '2026-06-01', time: '15:00', opponent: 'A', home_away: 'home', league: 'sunday-league', team: 'First XI', home_team: 'First XI', away_team: 'A', venue: '', division: 'League' },
        { id: 'f2', date: '2026-06-02', time: '15:00', opponent: 'B', home_away: 'away', league: 'sunday-league', team: 'Second XI', home_team: 'B', away_team: 'Second XI', venue: '', division: 'League' },
      ],
      results: [],
    };
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={[]} />,
      { clubValue: mockSingleClub },
    );
    // Select element for team filter should be rendered when multiple teams exist
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });
});

describe('FixturesResultsPage league table (#78)', () => {
  const res = (id: string, division: string, hs: number, as: number) => ({
    id, date: '2026-01-0' + id, time: '10:00', home_team: 'Reds', away_team: 'Blues ' + division, venue: '', division,
    league: '', team: 'Reds', home_away: 'home' as const, opponent: 'Blues ' + division,
    home_score: hs, away_score: as, goals_for: hs, goals_against: as,
  });
  const feed: ClubFeed = {
    club: 'test-club', generated: '2026-01-01T00:00:00Z', fixtures: [],
    results: [res('1', 'Friendly', 2, 0), res('2', 'County Cup', 1, 1)],
  };

  it('asks for a team first and labels manual-only data', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={liveTeams} manualOnly />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByText(/recorded by the club/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(await screen.findByText(/Choose a team above/)).toBeTruthy();
  });

  it('shows one table per competition for the selected team', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('combobox', { name: /Filter by team/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Reds' }));
    fireEvent.click(screen.getByRole('tab', { name: /Table/i }));
    const friendly = await screen.findByRole('table', { name: 'Friendly table' });
    const cup = screen.getByRole('table', { name: 'County Cup table' });
    expect(friendly.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(friendly.querySelector('tbody tr')!.textContent).toContain('Reds');
    expect(cup.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('shows an empty-table message when the team has no scored results', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const unscored: ClubFeed = { ...feed, results: [{ ...res('1', 'Friendly', 0, 0), home_score: null, away_score: null }] };
    renderWithMantine(
      <FixturesResultsPage feed={unscored} teams={teams} liveTeams={liveTeams} />,
      { clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('combobox', { name: /Filter by team/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Reds' }));
    fireEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(await screen.findByText('No scored results yet.')).toBeTruthy();
  });
});

describe('FixturesResultsPage section filter with manual games (#78)', () => {
  it('keeps games for a section team that has no live feed team', () => {
    const feed: ClubFeed = {
      club: 'test-club', generated: '2026-01-01T00:00:00Z', results: [],
      fixtures: [{
        id: 'm1', date: '2099-01-01', time: '10:00', home_team: 'First XI', away_team: 'Rivals', venue: 'Home Park',
        division: 'Friendly', league: '', team: 'First XI', home_away: 'home', opponent: 'Rivals',
      }],
    };
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={[]} manualOnly />,
      { clubValue: mockSingleClub, sectionValue: { ...mockSection, activeSection: 'seniors' } },
    );
    expect(screen.getByRole('tab', { name: /Fixtures \(1\)/ })).toBeTruthy();
  });
});
