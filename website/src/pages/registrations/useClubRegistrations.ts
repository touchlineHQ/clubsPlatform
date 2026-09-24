import { useCallback, useEffect, useRef, useState } from 'react';
import { captureError } from '../../lib/posthog';
import type { RegistrationSummary } from '../../utils/registrationSummary';
import { ALL, type ClubFilters, type RegistrationRow, type SortState } from './types';

/**
 * One page of the club's registrations, plus the filter options and the counts.
 *
 * Three requests rather than one, deliberately. The page is bounded; the facets
 * and the summary cover the whole club and the whole filtered set respectively,
 * which is what stops pagination quietly redefining them as "whatever is on
 * page 1".
 *
 * The list and the summary are separate requests against a database with no
 * cross-request transaction, so a manual-paid toggle landing between them can
 * leave the header disagreeing with the rows for one render. Refreshing is
 * cheap and the next one reconciles them.
 */

export const PAGE_SIZE = 50;

export interface ClubRegistrationsState {
  rows: RegistrationRow[];
  facets: { teams: string[]; statuses: string[] };
  summary: RegistrationSummary | null;
  filters: ClubFilters;
  search: string;
  sort: SortState;
  loading: boolean;
  /** The summary lags the page; the strip renders a loading state from this. */
  summaryLoading: boolean;
  error: string;
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const EMPTY_FACETS = { teams: [], statuses: [] };

function queryFor(filters: ClubFilters, search: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.team !== ALL) params.set('team', filters.team);
  if (filters.status !== ALL) params.set('status', filters.status);
  if (filters.subscription !== ALL) params.set('subscription', filters.subscription);
  if (search.trim()) params.set('q', search.trim());
  return params;
}

export function useClubRegistrations(clubSlug: string, enabled: boolean, reloadToken = 0) {
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [facets, setFacets] = useState(EMPTY_FACETS as { teams: string[]; statuses: string[] });
  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [filters, setFiltersState] = useState<ClubFilters>({ team: ALL, status: ALL, subscription: ALL });
  const [search, setSearchState] = useState('');
  const [sort, setSortState] = useState<SortState>({ key: 'teamName', dir: 'asc' });
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState('');

  /**
   * The cursor for each page visited, so Back can return to one.
   *
   * A keyset cursor only walks forward, so the trail is the only way back.
   * Index 0 is page 1 and is always null.
   */
  const [trail, setTrail] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  /** Discards a response that a newer request has already superseded. */
  const requestVersion = useRef(0);

  const headers = { 'X-Club-Slug': clubSlug };

  const loadPage = useCallback(async (cursor: string | null) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const params = queryFor(filters, search);
      params.set('limit', String(PAGE_SIZE));
      params.set('sort', sort.key);
      params.set('dir', sort.dir);
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`/api/admin/registrations?${params}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to load registrations');
      }
      const data = await res.json() as { rows?: RegistrationRow[]; nextCursor?: string | null };
      if (version !== requestVersion.current) return;

      setRows(data.rows ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      if (version !== requestVersion.current) return;
      captureError(e, { op: 'registrations.page' });
      setError(e instanceof Error ? e.message : 'Failed to load registrations');
      setRows([]);
      setNextCursor(null);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [clubSlug, filters, search, sort]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(
        `/api/admin/registration-summary?${queryFor(filters, search)}`,
        { headers },
      );
      if (!res.ok) throw new Error('summary unavailable');
      setSummary(await res.json() as RegistrationSummary);
    } catch {
      // Non-fatal: the strip hides rather than blocking the table.
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [clubSlug, filters, search]);

  const loadFacets = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/registration-facets', { headers });
      if (!res.ok) return;
      const data = await res.json() as { teams?: string[]; statuses?: string[] };
      setFacets({ teams: data.teams ?? [], statuses: data.statuses ?? [] });
    } catch {
      // Non-fatal — the filter Selects just offer nothing but "All".
    }
  }, [clubSlug]);

  // Facets are club-scoped, so they outlive every filter and page change.
  useEffect(() => {
    if (enabled) loadFacets();
  }, [enabled, loadFacets]);

  // Any change to what is being asked for resets to page 1. Keeping the cursor
  // would apply a position minted against a different result set. `reloadToken`
  // is bumped by an import, which can change the set under the reader entirely.
  useEffect(() => {
    if (!enabled) return;
    setTrail([null]);
    setPageIndex(0);
    loadPage(null);
    loadSummary();
  }, [enabled, filters, search, sort, reloadToken, loadPage, loadSummary]);

  const setFilters = useCallback((next: ClubFilters) => setFiltersState(next), []);
  const setSearch = useCallback((next: string) => setSearchState(next), []);
  const setSort = useCallback((next: SortState) => setSortState(next), []);

  const goNext = useCallback(() => {
    if (!nextCursor) return;
    setTrail(prev => [...prev.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex(i => i + 1);
    loadPage(nextCursor);
  }, [nextCursor, pageIndex, loadPage]);

  const goPrev = useCallback(() => {
    if (pageIndex === 0) return;
    setPageIndex(i => i - 1);
    loadPage(trail[pageIndex - 1] ?? null);
  }, [pageIndex, trail, loadPage]);

  /**
   * Reload without losing the reader's place.
   *
   * Used after a level change or a merge, where the row the admin just acted on
   * is on screen and sending them back to page 1 would lose it. The summary
   * comes along because those actions move its numbers.
   */
  const refresh = useCallback(() => {
    loadPage(trail[pageIndex] ?? null);
    loadSummary();
  }, [loadPage, loadSummary, trail, pageIndex]);

  /** Drop a row locally, for a delete that has already succeeded. */
  const removeRow = useCallback((registrationId: string) => {
    setRows(prev => prev.filter(r => r.registrationId !== registrationId));
  }, []);

  /** Patch a row in place, for an optimistic level change. */
  const patchRow = useCallback((registrationId: string, patch: Partial<RegistrationRow>) => {
    setRows(prev => prev.map(r => (r.registrationId === registrationId ? { ...r, ...patch } : r)));
  }, []);

  const state: ClubRegistrationsState = {
    rows,
    facets,
    summary,
    filters,
    search,
    sort,
    loading,
    summaryLoading,
    error,
    page: pageIndex + 1,
    hasNext: nextCursor !== null,
    hasPrev: pageIndex > 0,
  };

  return { ...state, setFilters, setSearch, setSort, goNext, goPrev, refresh, removeRow, patchRow };
}
