import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useAllClubRegistrations,
  ExportTooLargeError,
  FETCH_ALL_PAGE_SIZE,
  MAX_PAGES,
} from '../../../pages/registrations/useAllClubRegistrations';
import { ALL, type ClubFilters, type RegistrationRow } from '../../../pages/registrations/types';

/**
 * The loop behind the export and the FA report.
 *
 * Both walk the paginated endpoint rather than reading the table's page, so the
 * failure this covers is silent by construction: a loop that stops early, or
 * that drops the filters after page 1, produces a file that looks complete and
 * is not. Nothing renders to say so.
 */

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

const NO_FILTERS: ClubFilters = { team: ALL, status: ALL, subscription: ALL };

/** A minimal club row; only the id is read back, so the rest is filler. */
function row(n: number): RegistrationRow {
  return {
    registrationId: `reg_${n}`,
    fanId: `fan_${n}`,
    teamName: 'First XI',
    ageGroup: null,
    registrationExpiry: null,
    registrationStatus: 'active',
    relationship: null,
    linkedAccounts: null,
    subscriptionLevelId: null,
    overrideLevelId: null,
    subscriptionLevelName: null,
    paymentStatus: null,
  };
}

/** Serves `pages` in order, each one's cursor pointing at the next. */
function servePages(pages: RegistrationRow[][]) {
  mockFetch.mockImplementation((url: string) => {
    const cursor = new URLSearchParams(String(url).split('?')[1] ?? '').get('cursor');
    const index = cursor ? Number(cursor) : 0;
    const last = index === pages.length - 1;
    return Promise.resolve({
      ok: true,
      json: async () => ({
        rows: pages[index] ?? [],
        nextCursor: last ? null : String(index + 1),
        limit: FETCH_ALL_PAGE_SIZE,
      }),
    });
  });
}

/** The query string of the nth call, 0-indexed. */
function queryOf(call: number): URLSearchParams {
  return new URLSearchParams(String(mockFetch.mock.calls[call]?.[0]).split('?')[1] ?? '');
}

describe('useAllClubRegistrations', () => {
  it('follows nextCursor to the end and returns every page in order', async () => {
    servePages([[row(1), row(2)], [row(3)], [row(4)]]);

    const { result } = renderHook(() => useAllClubRegistrations('demo'));

    let rows: RegistrationRow[] = [];
    await act(async () => {
      rows = await result.current.loadAll(NO_FILTERS, '');
    });

    expect(rows.map(r => r.registrationId)).toEqual(['reg_1', 'reg_2', 'reg_3', 'reg_4']);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(queryOf(0).get('cursor')).toBeNull();
    expect(queryOf(1).get('cursor')).toBe('1');
    expect(queryOf(2).get('cursor')).toBe('2');
  });

  it('sends the filters and the search on every page, not just the first', async () => {
    // Dropping these after page 1 would widen the export past what the admin
    // filtered to, while the first page still matched.
    servePages([[row(1)], [row(2)]]);

    const { result } = renderHook(() => useAllClubRegistrations('demo'));
    await act(async () => {
      await result.current.loadAll(
        { team: 'U15 Reds', status: 'active', subscription: 'paid' },
        ' fan_1 ',
      );
    });

    for (const call of [0, 1]) {
      const q = queryOf(call);
      expect(q.get('team')).toBe('U15 Reds');
      expect(q.get('status')).toBe('active');
      expect(q.get('subscription')).toBe('paid');
      expect(q.get('q')).toBe('fan_1');
      expect(q.get('limit')).toBe(String(FETCH_ALL_PAGE_SIZE));
    }
  });

  it('omits a filter left at its default rather than binding the sentinel', async () => {
    servePages([[row(1)]]);

    const { result } = renderHook(() => useAllClubRegistrations('demo'));
    await act(async () => {
      await result.current.loadAll(NO_FILTERS, '   ');
    });

    const q = queryOf(0);
    expect(q.get('team')).toBeNull();
    expect(q.get('status')).toBeNull();
    expect(q.get('subscription')).toBeNull();
    expect(q.get('q')).toBeNull();
  });

  it('scopes every page to the club', async () => {
    servePages([[row(1)], [row(2)]]);

    const { result } = renderHook(() => useAllClubRegistrations('east-leake-fc'));
    await act(async () => {
      await result.current.loadAll(NO_FILTERS, '');
    });

    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toMatchObject({ headers: { 'X-Club-Slug': 'east-leake-fc' } });
    }
  });

  it('refuses rather than truncating when the filtered set outruns the cap', async () => {
    // A short export that looks complete is worse than one that refuses: the
    // treasurer chases the rows it contains and never learns about the rest.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [row(1)], nextCursor: 'more', limit: FETCH_ALL_PAGE_SIZE }),
    });

    const { result } = renderHook(() => useAllClubRegistrations('demo'));

    await act(async () => {
      await expect(result.current.loadAll(NO_FILTERS, '')).rejects.toThrow(ExportTooLargeError);
    });

    expect(mockFetch).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('counts up as it goes, and stops running once it has finished', async () => {
    servePages([[row(1), row(2)], [row(3)]]);

    const { result } = renderHook(() => useAllClubRegistrations('demo'));
    expect(result.current.running).toBe(false);

    await act(async () => {
      await result.current.loadAll(NO_FILTERS, '');
    });

    expect(result.current.progress).toBe(3);
    expect(result.current.running).toBe(false);
  });

  it('stops running when a page fails, and surfaces the error the server named', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'club scan failed' }),
    });

    const { result } = renderHook(() => useAllClubRegistrations('demo'));

    await act(async () => {
      await expect(result.current.loadAll(NO_FILTERS, '')).rejects.toThrow('club scan failed');
    });

    // Without the finally the button would stay stuck on "Exporting …".
    expect(result.current.running).toBe(false);
  });

  it('falls back to a generic message when the failure carries no JSON', async () => {
    // An edge error page is not our `{ error }` shape, and it is exactly the
    // case #107 turned out to be.
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });

    const { result } = renderHook(() => useAllClubRegistrations('demo'));

    await act(async () => {
      await expect(result.current.loadAll(NO_FILTERS, ''))
        .rejects.toThrow('Failed to load registrations');
    });
  });

  it('resets the count between runs', async () => {
    servePages([[row(1), row(2)]]);

    const { result } = renderHook(() => useAllClubRegistrations('demo'));
    await act(async () => { await result.current.loadAll(NO_FILTERS, ''); });
    expect(result.current.progress).toBe(2);

    servePages([[row(3)]]);
    await act(async () => { await result.current.loadAll(NO_FILTERS, ''); });
    expect(result.current.progress).toBe(1);
  });
});
