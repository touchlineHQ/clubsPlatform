const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Format a past quantity with the appropriate singular or plural unit. */
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/**
 * Coarse "3 days ago" phrasing for a millisecond timestamp.
 *
 * Deliberately not dayjs: it is only here as a transitive dependency of
 * @mantine/dates, nothing in the app imports it, and its relativeTime plugin is
 * not registered. Pair this with the exact timestamp on hover — the whole point
 * of showing it is to let someone judge whether the data is worth trusting.
 */
export function timeAgo(timestampMs: number, now: number = Date.now()): string {
  const elapsed = now - timestampMs;

  if (elapsed < 0) return 'just now';
  if (elapsed < MINUTE) return 'a few seconds ago';
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < MONTH) return plural(Math.floor(elapsed / DAY), 'day');
  if (elapsed < YEAR) return plural(Math.floor(elapsed / MONTH), 'month');
  return plural(Math.floor(elapsed / YEAR), 'year');
}
