import { useCallback, useState } from 'react';
import { ALL, type ClubFilters, type RegistrationRow } from './types';

/**
 * Every row matching the current filters, gathered by walking the paginated
 * endpoint.
 *
 * The export and the FA status report both need the whole filtered set, not the
 * page on screen. Looping the same endpoint keeps one definition of what a
 * filter means; a dedicated "fetch all" endpoint would re-create the unbounded
 * query this work exists to remove, behind a different URL, and fork the filter
 * logic into two places that will disagree.
 *
 * Bounded rather than unbounded. Past the cap the caller is told to narrow its
 * filters instead of being handed a silently truncated file — a short export
 * that looks complete is worse than one that refuses.
 */

/** Big pages, because this is a background loop rather than a render. */
export const FETCH_ALL_PAGE_SIZE = 200;
export const MAX_PAGES = 50;
export const MAX_ROWS = FETCH_ALL_PAGE_SIZE * MAX_PAGES;

export class ExportTooLargeError extends Error {
  constructor() {
    super('Narrow your filters — this export is too large');
    this.name = 'ExportTooLargeError';
  }
}

export function useAllClubRegistrations(clubSlug: string) {
  /** Rows fetched so far, so the button can count up like the import does. */
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const loadAll = useCallback(async (
    filters: ClubFilters,
    search: string,
  ): Promise<RegistrationRow[]> => {
    setRunning(true);
    setProgress(0);
    try {
      const all: RegistrationRow[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams();
        if (filters.team !== ALL) params.set('team', filters.team);
        if (filters.status !== ALL) params.set('status', filters.status);
        if (filters.subscription !== ALL) params.set('subscription', filters.subscription);
        if (search.trim()) params.set('q', search.trim());
        params.set('limit', String(FETCH_ALL_PAGE_SIZE));
        if (cursor) params.set('cursor', cursor);

        const res = await fetch(`/api/admin/registrations?${params}`, {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? 'Failed to load registrations');
        }

        const data = await res.json() as { rows?: RegistrationRow[]; nextCursor?: string | null };
        all.push(...(data.rows ?? []));
        setProgress(all.length);

        cursor = data.nextCursor ?? null;
        if (!cursor) return all;
      }

      // Ran out of pages with a cursor still in hand: there is more than the cap.
      throw new ExportTooLargeError();
    } finally {
      setRunning(false);
    }
  }, [clubSlug]);

  return { loadAll, progress, running };
}
