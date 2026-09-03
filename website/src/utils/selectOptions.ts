/**
 * Mantine's Select/Autocomplete family throws
 * `[@mantine/core] Duplicate options are not supported` when its option list
 * repeats a value, and the throw happens during render — so one duplicate takes
 * the whole page down rather than degrading that single field.
 *
 * Two things make this easy to hit:
 *  - Options are validated across groups, sharing one value set, so the same
 *    team listed under "Your Teams" and under its section is a duplicate.
 *  - Lists built from the external fixtures feed repeat by design: a club or
 *    team is listed once per league, which is what broke `loadClubSlugs()`.
 *
 * Run any option list that isn't a hardcoded constant or keyed by a database
 * primary key through this first.
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
      // Recurse with the same `seen` set — Mantine validates across groups too.
      const items = dedupe(entry.items, seen);
      // Drop groups left empty, otherwise the user sees a bare heading.
      if (items.length > 0) result.push({ ...entry, items });
      continue;
    }

    if (isOptionItem(entry)) {
      if (seen.has(entry.value)) continue;
      seen.add(entry.value);
      result.push(entry);
      continue;
    }

    // Shape we don't recognise: leave it alone rather than silently dropping it.
    result.push(entry);
  }

  return result;
}

/**
 * Remove duplicate options, keeping the first occurrence so ordering and any
 * preferred grouping (for example "Your Teams" first) survive.
 *
 * Accepts the shapes Mantine accepts: plain strings, `{ value, label }` items,
 * and `{ group, items }` groups.
 */
export function dedupeOptions<T>(data: T[]): T[] {
  return dedupe(data, new Set<string>());
}
