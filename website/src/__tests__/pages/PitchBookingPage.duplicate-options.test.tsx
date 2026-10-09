import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockMember, mockSingleClub } from '../test-utils';
import type { LiveTeam, UserTeamRole } from '../../types';

const mockFetch = vi.fn();

const SECTIONS = [{ id: 's1', name: 'Juniors' }];
const TEAMS = [{ id: 't1', sectionId: 's1', name: 'Under 12s' }];

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
    if (url.includes('/api/teams')) return { ok: true, json: async () => ({ sections: SECTIONS, teams: TEAMS }) };
    if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

import { PitchBookingPage } from '../../pages/PitchBookingPage';

/** Open the "Team" Select so Mantine renders (and validates) its options. */
async function openTeamDropdown() {
  const input = await screen.findByPlaceholderText('Select your team');
  fireEvent.click(input);
  await waitFor(() => {
    expect(document.querySelector('.mantine-Select-dropdown, [role="listbox"]')).toBeTruthy();
  });
}

describe('PitchBookingPage — duplicate team options', () => {
  it('does not crash when a coach also appears in the defined-teams list', async () => {
    // Both paths build `defined:t1|Under 12s`.
    const teamRoles: UserTeamRole[] = [
      { id: 'r1', teamSlug: 'under-12s', teamLeague: 'juniors', teamName: 'Under 12s', role: 'coach' },
    ];

    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: { ...mockMember, teamRoles },
      clubValue: mockSingleClub,
    });

    await openTeamDropdown();

    expect(screen.getByText('Your Teams')).toBeTruthy();
    expect(screen.getAllByText('Under 12s (coach)')).toHaveLength(1);
  });

  it('does not crash when a user holds two roles on the same team', async () => {
    const teamRoles: UserTeamRole[] = [
      { id: 'r1', teamSlug: 'under-12s', teamLeague: 'juniors', teamName: 'Under 12s', role: 'coach' },
      { id: 'r2', teamSlug: 'under-12s', teamLeague: 'juniors', teamName: 'Under 12s', role: 'manager' },
    ];

    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: { ...mockMember, teamRoles },
      clubValue: mockSingleClub,
    });

    await openTeamDropdown();

    expect(screen.getByText('Your Teams')).toBeTruthy();
  });

  it('does not crash when the feed lists the same dynamic team twice', async () => {
    // Also covers the stale-state bug: the group rendered empty on first load.
    const liveTeams = [
      { name: 'First Team', slug: 'first-team', league: 'county' },
      { name: 'First Team', slug: 'first-team', league: 'county' },
    ] as LiveTeam[];

    renderWithMantine(<PitchBookingPage liveTeams={liveTeams} />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await openTeamDropdown();

    expect(screen.getAllByText('First Team (county)')).toHaveLength(1);
  });
});
