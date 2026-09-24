import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerRegistrationRow } from './types';

/**
 * Typeahead state for the player picker, shared by both payment tabs.
 *
 * The endpoint used to hand back every registration in the club and the tabs
 * filtered in the browser. It searches server-side now, which means two things
 * the old version got for free have to be handled here:
 *
 * - **The selection has to outlive the search.** Once the results are whatever
 *   matched the last keystroke, the row backing the current selection is
 *   usually not among them, and a Mantine `Select` whose `value` has no
 *   matching option renders blank. `selected` is kept separately and
 *   rehydrated by id when it is missing.
 * - **Keystrokes have to be debounced and ordered.** Without the sequence
 *   guard a slow response for "FA" can land after a fast one for "FAN12" and
 *   replace better results with worse ones.
 */

/** Matches MIN_QUERY_CHARS on the endpoint; below this it returns nothing. */
export const MIN_QUERY_CHARS = 2;
const DEBOUNCE_MS = 250;

export function usePlayerRegistrationSearch(clubHeaders: HeadersInit) {
  const [results, setResults] = useState<PlayerRegistrationRow[]>([]);
  const [selected, setSelected] = useState<PlayerRegistrationRow | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  /** Discards a response a newer keystroke has already superseded. */
  const sequence = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }

    const version = ++sequence.current;
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/admin/player-registrations?q=${encodeURIComponent(q)}`, { headers: clubHeaders })
        .then(r => (r.ok ? r.json() as Promise<{ registrations: PlayerRegistrationRow[] }> : Promise.reject()))
        .then(d => {
          if (version !== sequence.current) return;
          setResults(d.registrations ?? []);
          setError('');
        })
        .catch(() => {
          if (version !== sequence.current) return;
          setError('Failed to search player registrations.');
          setResults([]);
        })
        .finally(() => {
          if (version === sequence.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, clubHeaders]);

  /**
   * Record a selection, fetching the full row when it is not in the results.
   *
   * The pricing fields autofill the subscription form, so a partial row here
   * would leave it silently blank.
   */
  const select = useCallback(async (registrationId: string | null) => {
    if (!registrationId) {
      setSelected(null);
      return null;
    }

    const known = results.find(r => r.registrationId === registrationId);
    if (known) {
      setSelected(known);
      return known;
    }

    try {
      const res = await fetch(
        `/api/admin/player-registrations?registrationId=${encodeURIComponent(registrationId)}`,
        { headers: clubHeaders },
      );
      if (!res.ok) throw new Error('lookup failed');
      const data = await res.json() as { registrations?: PlayerRegistrationRow[] };
      const row = data.registrations?.[0] ?? null;
      setSelected(row);
      return row;
    } catch {
      setError('Failed to load that registration.');
      return null;
    }
  }, [results, clubHeaders]);

  /**
   * Options for the Select, with the selected row always present.
   *
   * Mantine renders a blank control when `value` has no matching option, so the
   * current selection has to stay in the list even once the search moved on.
   */
  const options = [
    ...results.map(r => ({ value: r.registrationId, label: `FAN ${r.fanId} — ${r.teamName}` })),
    ...(selected && !results.some(r => r.registrationId === selected.registrationId)
      ? [{ value: selected.registrationId, label: `FAN ${selected.fanId} — ${selected.teamName}` }]
      : []),
  ];

  const nothingFoundMessage = query.trim().length < MIN_QUERY_CHARS
    ? `Type ${MIN_QUERY_CHARS} or more characters to search`
    : searching ? 'Searching…' : 'No players match your search';

  return { results, selected, select, query, setQuery, searching, error, options, nothingFoundMessage };
}
