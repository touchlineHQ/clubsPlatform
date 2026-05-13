import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockMember, mockSingleClub } from '../test-utils';
import type { LiveTeam } from '../../types';

const mockParams = vi.hoisted(() => ({ teamSlug: 'first-xi', league: 'sunday-league' }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useParams: () => mockParams,
}));

const mockLoadTeamFeed = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('../../data', () => ({
  loadTeamFeed: mockLoadTeamFeed,
  teamCalendarUrl: vi.fn(() => 'https://example.com/calendar.ics'),
}));

// CopyButton and Tooltip use features not available in jsdom; stub them.
vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    CopyButton: ({ children }: { children: (props: { copy: () => void; copied: boolean }) => React.ReactNode }) =>
      children({ copy: vi.fn(), copied: false }),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { TeamPage } from '../../pages/TeamPage';

const liveTeams: LiveTeam[] = [
  { slug: 'first-xi', name: 'First XI', league: 'sunday-league', leagueUrl: null, leagueName: 'Sunday League', contact: null },
];

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.teamSlug = 'first-xi';
    mockLoadTeamFeed.mockResolvedValue(null);
  });

  it('shows loader initially', () => {
    mockLoadTeamFeed.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows team name when feed loads successfully', async () => {
    mockLoadTeamFeed.mockResolvedValue({
      team_name: 'First XI',
      fixtures: [],
      results: [],
      next_fixture: null,
      contact: null,
    });

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('First XI')).toBeTruthy();
    });
  });

  it('shows an error when team is not found in liveTeams', async () => {
    mockParams.teamSlug = 'unknown-team';

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });

  it('shows Fixtures and Results tabs when feed loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }));
    mockLoadTeamFeed.mockResolvedValue({
      team_name: 'First XI', fixtures: [], results: [], next_fixture: null, contact: null,
    });

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut, clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Fixtures/i })).toBeTruthy();
      expect(screen.getByRole('tab', { name: /Results/i })).toBeTruthy();
    });
  });

  it('shows fixture opponent when feed has fixtures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }));
    mockLoadTeamFeed.mockResolvedValue({
      team_name: 'First XI',
      fixtures: [{ id: 'f1', date: '2026-06-01', time: '15:00', opponent: 'Rivals FC', home_away: 'home', league: 'sunday-league', team: 'First XI', home_team: 'First XI', away_team: 'Rivals FC', venue: '', division: 'League' }],
      results: [],
      next_fixture: null,
      contact: null,
    });

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut, clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByText('Rivals FC').length).toBeGreaterThan(0);
    });
  });

  it('shows result opponent on Results tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }));
    mockLoadTeamFeed.mockResolvedValue({
      team_name: 'First XI',
      fixtures: [],
      results: [{ id: 'r1', date: '2026-05-01', time: '15:00', opponent: 'Old Rivals', home_away: 'away', league: 'sunday-league', team: 'First XI', home_team: 'Old Rivals', away_team: 'First XI', venue: '', division: 'League', goals_for: 2, goals_against: 1, home_score: 2, away_score: 1 }],
      next_fixture: null,
      contact: null,
    });

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockLoggedOut, clubValue: mockSingleClub,
    });

    await waitFor(() => {
      const tab = screen.getByRole('tab', { name: /Results/i });
      fireEvent.click(tab);
    });

    await waitFor(() => {
      expect(screen.getByText('Old Rivals')).toBeTruthy();
    });
  });

  it('shows follow team button for logged-in user without existing role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }));
    mockLoadTeamFeed.mockResolvedValue({
      team_name: 'First XI', fixtures: [], results: [], next_fixture: null, contact: null,
    });

    renderWithMantine(<TeamPage liveTeams={liveTeams} />, {
      authValue: mockMember, clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/Follow team/i)).toBeTruthy();
    });
  });
});
