import { useCallback, useEffect, useRef, useState } from 'react';
import { captureError } from '../../lib/posthog';
import { normaliseAgeGroup } from '../../utils/mergeSuggestions';

/**
 * The club's merge suggestions, and the ones an admin has dismissed.
 *
 * Both come from the server, which is the whole point: the grouping used to run
 * over the club held in browser memory, and #114 paged that array away. The
 * counts here are the club's, not the loaded page's.
 *
 * Kept separate from `useClubRegistrations` rather than folded into it. The two
 * are refreshed by different things — dismissing changes the banner and leaves
 * the table alone; paging changes the table and leaves the banner alone — and
 * one hook owning both would reload whichever half did not need it.
 */

/** The first page is the whole list for any realistic club; 18 is the worst seen. */
export const SUGGESTION_PAGE_SIZE = 50;

export interface MergeSuggestionSet {
  playerId: string;
  fanId: string;
  ageGroup: string;
  setSize: number;
  registrationIds: string[];
  teamNames: string[];
}

export interface DismissedSuggestion {
  playerId: string;
  fanId: string;
  ageKey: string;
  ageGroup: string;
  setSize: number;
  dismissedBy: string;
  dismissedAt: number;
}

const ENDPOINT = '/api/admin/registration-merge-suggestions';

export function useMergeSuggestions(clubSlug: string, enabled: boolean, reloadToken = 0) {
  const [suggestions, setSuggestions] = useState<MergeSuggestionSet[]>([]);
  const [dismissed, setDismissed] = useState<DismissedSuggestion[]>([]);
  /** The club's count, which a page of suggestions cannot state for itself. */
  const [openCount, setOpenCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);
  /**
   * Whether the endpoint had more than this one page.
   *
   * Not followed. A page is 50 and the busiest club we have has 18, so a second
   * page is a hypothetical — and the banner already states the club's count, so
   * a truncated list says so and points at "Review them", which narrows the
   * table to all of them rather than to a page of them.
   */
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dismissedLoading, setDismissedLoading] = useState(false);

  /** Discards a response a newer request has already superseded. */
  const requestVersion = useRef(0);

  const headers = { 'X-Club-Slug': clubSlug };

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const res = await fetch(`${ENDPOINT}?limit=${SUGGESTION_PAGE_SIZE}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to load merge suggestions');
      }
      const data = await res.json() as {
        suggestions?: MergeSuggestionSet[];
        nextCursor?: string | null;
        openCount?: number;
        dismissedCount?: number;
      };
      if (version !== requestVersion.current) return;

      const loaded = data.suggestions ?? [];
      setSuggestions(loaded);
      setTruncated((data.nextCursor ?? null) !== null);
      // Fall back to what arrived rather than to zero: a banner that says
      // nothing while showing sets would be worse than a slightly stale count.
      setOpenCount(data.openCount ?? loaded.length);
      setDismissedCount(data.dismissedCount ?? 0);
    } catch (e) {
      if (version !== requestVersion.current) return;
      // Silent, like the facets and the summary: a hint that cannot load hides
      // rather than blocking the table. captureError is the record of it.
      captureError(e, { op: 'registrations.suggestions' });
      setSuggestions([]);
      setTruncated(false);
      setOpenCount(0);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [clubSlug]);

  const loadDismissed = useCallback(async () => {
    setDismissedLoading(true);
    try {
      const res = await fetch(`${ENDPOINT}?state=dismissed&limit=${SUGGESTION_PAGE_SIZE}`, { headers });
      if (!res.ok) throw new Error('dismissals unavailable');
      const data = await res.json() as { suggestions?: DismissedSuggestion[] };
      setDismissed(data.suggestions ?? []);
    } catch (e) {
      captureError(e, { op: 'registrations.suggestions.dismissed' });
      setDismissed([]);
    } finally {
      setDismissedLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, reloadToken, load]);

  /**
   * Record that a set is genuinely separate.
   *
   * Removes it from the banner locally rather than reloading: the admin is
   * looking at the list they just acted on, and re-fetching it would reorder
   * under them for one row. The count moves with it so the two cannot disagree.
   */
  const dismiss = useCallback(async (playerId: string, ageGroup: string, setSize: number) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      // The size that was on screen, so the server can refuse a dismissal for a
      // set that has grown since. Without it the server would store its own
      // count and quietly suppress registrations the admin never reviewed.
      body: JSON.stringify({ playerId, ageGroup, setSize }),
    });
    if (res.status === 409) {
      // The set changed underneath them — reload so they are looking at it.
      await load();
      throw new Error('That set has changed since it was loaded. Have another look.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? 'Failed to dismiss the suggestion');
    }
    // Matched on the normalised key, not the display casing, so the caller can
    // pass whichever spelling of the age group it happens to hold.
    const ageKey = normaliseAgeGroup(ageGroup);
    setSuggestions(prev => prev.filter(
      s => !(s.playerId === playerId && normaliseAgeGroup(s.ageGroup) === ageKey),
    ));
    setOpenCount(n => Math.max(0, n - 1));
    setDismissedCount(n => n + 1);
  }, [clubSlug, load]);

  /** Undo a dismissal. Reloads, because the set returns to a sorted list. */
  const restore = useCallback(async (playerId: string, ageGroup: string) => {
    const params = new URLSearchParams({ playerId, ageGroup });
    const res = await fetch(`${ENDPOINT}?${params}`, { method: 'DELETE', headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? 'Failed to restore the suggestion');
    }
    const ageKey = normaliseAgeGroup(ageGroup);
    setDismissed(prev => prev.filter(d => !(d.playerId === playerId && d.ageKey === ageKey)));
    await load();
  }, [clubSlug, load]);

  return {
    suggestions,
    dismissed,
    openCount,
    dismissedCount,
    truncated,
    loading,
    dismissedLoading,
    loadDismissed,
    dismiss,
    restore,
    refresh: load,
  };
}
