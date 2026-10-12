import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithMantine } from '../../test-utils';

vi.mock('../../../lib/posthog', () => ({ captureEvent: vi.fn(), captureError: vi.fn() }));
import { captureError } from '../../../lib/posthog';
import { TeamBreakdownTab } from '../../../pages/registrations/TeamBreakdownTab';
import { MAX_PAGES } from '../../../pages/registrations/useAllClubRegistrations';

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); vi.mocked(captureError).mockReset(); });

const ok = (body: unknown) => ({ ok: true, json: async () => body });

/** Routes /api/teams separately from the paginated registrations. */
function route(pages: unknown[], teams: unknown = { teams: [] }) {
  let i = 0;
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/teams')) {
      return teams instanceof Error ? Promise.reject(teams) : teams === null ? { ok: false, json: async () => ({}) } : ok(teams);
    }
    const page = pages[Math.min(i++, pages.length - 1)];
    return page;
  });
}
const regCalls = () => mockFetch.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/registrations'));
const r = (id: string, teamName: string, o: Record<string, unknown> = {}) => ({
  registrationId: id, fanId: id, teamName, registrationStatus: 'Active', registrationExpiry: null,
  subscriptionLevelId: 'lvl', overrideLevelId: null, paymentStatus: 'active', ...o,
});

function teamRows() {
  const table = screen.getByRole('table', { name: 'Team breakdown' });
  return within(table).getAllByRole('row').slice(1).map(tr => within(tr).getAllByRole('cell').map(c => c.textContent));
}

describe('TeamBreakdownTab', () => {
  it('loads every page unfiltered and shows one row per team', async () => {
    route([
      ok({ rows: [r('a', 'U12'), r('b', 'U9', { paymentStatus: null })], nextCursor: 'c1' }),
      ok({ rows: [r('c', 'U12', { registrationStatus: 'Training Only', subscriptionLevelId: null, paymentStatus: null })], nextCursor: null }),
    ]);
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    await screen.findByRole('table', { name: 'Team breakdown' });
    expect(regCalls()).toHaveLength(2);
    const url = String(regCalls()[0][0]);
    expect(url).not.toContain('team=');
    expect(teamRows()).toEqual([
      ['U9', '1', '0', '1', '0', '1', '0'],
      ['U12', '1', '1', '2', '1', '0', '1'],
    ]);

    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    const firstAfter = async (value: string) => {
      fireEvent.change(sort, { target: { value } });
      await waitFor(() => expect((sort as HTMLSelectElement).value).toBe(value));
      return teamRows()[0][0];
    };
    expect(await firstAfter('outstanding')).toBe('U9');
    expect(await firstAfter('issues')).toBe('U12');
    expect(await firstAfter('league')).toBe('U9');
    expect(await firstAfter('training')).toBe('U9');
    expect(await firstAfter('teamName')).toBe('U9');
  });

  it('handles an empty club', async () => {
    route([ok({ rows: [], nextCursor: null })], null);
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText(/No teams or registrations yet/)).toBeInTheDocument();
  });

  it('shows configured teams with zero registrations', async () => {
    route([ok({ rows: [r('a', 'U12')], nextCursor: null })], { teams: [{ name: 'U7' }, { name: 'U12' }, { name: 3 }] });
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    await screen.findByRole('table', { name: 'Team breakdown' });
    expect(teamRows()).toEqual([
      ['U7', '0', '0', '0', '0', '0', '0'],
      ['U12', '1', '0', '1', '1', '0', '0'],
    ]);
  });

  it('ignores a failing teams endpoint', async () => {
    route([ok({ rows: [r('a', 'U12')], nextCursor: null })], new Error('down'));
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    await screen.findByRole('table', { name: 'Team breakdown' });
    expect(teamRows()).toHaveLength(1);
  });

  it('reports a failed load', async () => {
    route([{ ok: false, json: async () => ({}) }]);
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText('Failed to load team breakdown')).toBeInTheDocument();
    expect(captureError).toHaveBeenCalled();
  });

  it('says when the club is too large', async () => {
    route([ok({ rows: [], nextCursor: 'more' })]);
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText(/too many registrations/)).toBeInTheDocument();
    expect(regCalls()).toHaveLength(MAX_PAGES);
  });
});
