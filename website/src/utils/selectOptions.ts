/**
 * Mantine's Select/Autocomplete family throws during render when an option list
 * repeats a value, taking the whole page down, and it validates groups against
 * one shared value set. Run any list built from merged sources or the external
 * feed through this first.
 */

interface OptionItem {
  value: string;
}

interface OptionGroup {
  group: string;
  items: OptionItem[];
}

function isOptionGroup(entry: unknown): entry is OptionGroup {
  return typeof entry === 'object' && entry !== null && Array.isArray((entry as OptionGroup).items);
}

function isOptionItem(entry: unknown): entry is OptionItem {
  return typeof entry === 'object' && entry !== null && typeof (entry as OptionItem).value === 'string';
}

function dedupe<T>(data: T[], seen: Set<string>): T[] {
  const result: T[] = [];

  for (const entry of data) {
    if (typeof entry === 'string') {
      if (seen.has(entry)) continue;
      seen.add(entry);
      result.push(entry);
      continue;
    }

    if (isOptionGroup(entry)) {
      // Shared `seen` set: Mantine validates across groups too.
      const items = dedupe(entry.items, seen);
      // Drop emptied groups so no bare heading renders.
      if (items.length > 0) result.push({ ...entry, items });
      continue;
    }

    if (isOptionItem(entry)) {
      if (seen.has(entry.value)) continue;
      seen.add(entry.value);
      result.push(entry);
      continue;
    }

    // Unrecognised shape: keep rather than silently drop.
    result.push(entry);
  }

  return result;
}

/**
 * Remove duplicate options, keeping the first occurrence so ordering and
 * grouping survive. Accepts strings, `{ value, label }` items, and
 * `{ group, items }` groups.
 */
export function dedupeOptions<T>(data: T[]): T[] {
  return dedupe(data, new Set<string>());
}
