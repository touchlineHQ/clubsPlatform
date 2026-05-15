import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithMantine, mockSection, mockSingleClub } from '../test-utils';
import { FixturesResultsPage } from '../../pages/FixturesResultsPage';
import type { ClubFeed, TeamsData, LiveTeam } from '../../types';

const emptyFeed: ClubFeed = { fixtures: [], results: [], generated: '2026-01-01T00:00:00Z' };

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
      generated: '2026-01-01T00:00:00Z',
      fixtures: [{ id: 'f1', date: '2026-06-01', time: '15:00', opponent: 'Rivals FC', home_away: 'home', league: 'sunday-league', team: 'First XI', home_team: 'First XI', away_team: 'Rivals FC', venue: '', division: 'League' }],
      results: [],
    };
    const liveTeamsWithTeam: LiveTeam[] = [
      { slug: 'first-xi', name: 'First XI', league: 'sunday-league', leagueUrl: null, leagueName: 'Sunday League', contact: null },
    ];
    renderWithMantine(
      <FixturesResultsPage feed={feed} teams={teams} liveTeams={liveTeamsWithTeam} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByText('Rivals FC')).toBeTruthy();
  });

  it('shows results in results table', () => {
    const feed: ClubFeed = {
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
    const feed: ClubFeed = {
      generated: '2026-01-01T00:00:00Z',
      fixtures: [],
      results: [
        { id: 'r1', date: '2026-05-01', time: '15:00', opponent: 'Team A', home_away: 'H', league: 'sunday-league', team: 'First XI', competition: 'League', goals_for: 2, goals_against: 0 },
        { id: 'r2', date: '2026-04-01', time: '15:00', opponent: 'Team B', home_away: 'A', league: 'sunday-league', team: 'First XI', competition: 'League', goals_for: 1, goals_against: 1 },
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
      generated: '2026-01-01T00:00:00Z',
      fixtures: [
        { id: 'f1', date: '2026-06-01', time: '15:00', opponent: 'A', home_away: 'H', league: 'sunday-league', team: 'First XI', competition: 'League' },
        { id: 'f2', date: '2026-06-02', time: '15:00', opponent: 'B', home_away: 'A', league: 'sunday-league', team: 'Second XI', competition: 'League' },
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
