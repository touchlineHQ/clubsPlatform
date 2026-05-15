import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../test-utils';
import type { LiveTeam } from '../../types';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  // Return appropriate data based on URL
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/admin/users')) return { ok: true, json: async () => ({ users: [] }) };
    if (url.includes('/api/admin/user-team-roles')) return { ok: true, json: async () => ({ assignments: [] }) };
    if (url.includes('/api/admin/player-registrations')) return { ok: true, json: async () => ({ registrations: [] }) };
    if (url.includes('/api/teams')) return { ok: true, json: async () => ({ sections: [], teams: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

import { AdminUsersPage } from '../../pages/AdminUsersPage';

const liveTeams: LiveTeam[] = [];

describe('AdminUsersPage', () => {
  it('renders a loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(<AdminUsersPage liveTeams={liveTeams} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('renders user list after loading', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/users')) return {
        ok: true,
        json: async () => ({ users: [{ id: 'u1', name: 'Test User', email: 'test@example.com', role: 'member', createdAt: '2024-01-01' }] }),
      };
      if (url.includes('/api/admin/user-team-roles')) return { ok: true, json: async () => ({ assignments: [] }) };
      if (url.includes('/api/admin/player-registrations')) return { ok: true, json: async () => ({ registrations: [] }) };
      if (url.includes('/api/teams')) return { ok: true, json: async () => ({ sections: [], teams: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<AdminUsersPage liveTeams={liveTeams} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeTruthy();
    });
  });

  it('shows an error when the API fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<AdminUsersPage liveTeams={liveTeams} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });
});
