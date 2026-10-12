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
    mockFetch
      .mockResolvedValueOnce(ok({ rows: [r('a', 'U12'), r('b', 'U9', { paymentStatus: null })], nextCursor: 'c1' }))
      .mockResolvedValueOnce(ok({ rows: [r('c', 'U12', { registrationStatus: 'Training Only', subscriptionLevelId: null, paymentStatus: null })], nextCursor: null }));
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    await screen.findByRole('table', { name: 'Team breakdown' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).not.toContain('team=');
    expect(teamRows()).toEqual([
      ['U9', '1', '0', '1', '1', '0', '1', '0'],
      ['U12', '1', '1', '2', '2', '1', '0', '1'],
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
    mockFetch.mockResolvedValueOnce(ok({ rows: [], nextCursor: null }));
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText(/No registrations yet/)).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText('Failed to load team breakdown')).toBeInTheDocument();
    expect(captureError).toHaveBeenCalled();
  });

  it('says when the club is too large', async () => {
    mockFetch.mockImplementation(async () => ok({ rows: [], nextCursor: 'more' }));
    renderWithMantine(<TeamBreakdownTab clubSlug="club" reloadToken={0} />);
    expect(await screen.findByText(/too many registrations/)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(MAX_PAGES);
  });
});
