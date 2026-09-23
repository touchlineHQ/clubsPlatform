/** Structural, so the page's own row type satisfies it. */
export interface SuggestionRow {
  registrationId: string;
  fanId: string;
  ageGroup?: string | null;
  /** The registration this one is billed through — itself, unless merged. */
  billingRegistrationId?: string | null;
  /** The other registrations billed through this one, when it is a primary. */
  mergedTeamNames?: string | null;
}

export interface MergeSuggestion {
  fanId: string;
  ageGroup: string;
  registrationIds: string[];
}

/** Case- and whitespace-insensitive, since age groups arrive from an FA export. */
function normaliseAgeGroup(ageGroup: string): string {
  return ageGroup.trim().toLowerCase();
}

/**
 * Registrations that look like they should be billed together but are not.
 *
 * Same player and age group is a hint, never a decision: U18 Blue and U18 Purple
 * share an age group and are two sets of subs, while U15s on different days are
 * billed once. Only the club knows which, so this surfaces candidates and stops.
 *
 * A set is suggested only while every member is billed separately — once any of
 * them is merged, the admin has already ruled on it.
 */
export function suggestMerges(rows: readonly SuggestionRow[]): MergeSuggestion[] {
  const byPlayerAndAge = new Map<string, SuggestionRow[]>();

  for (const row of rows) {
    if (!row.ageGroup?.trim()) continue;
    if (
      (row.billingRegistrationId && row.billingRegistrationId !== row.registrationId)
      || row.mergedTeamNames
    ) continue;
    const key = `${row.fanId}\u0000${normaliseAgeGroup(row.ageGroup)}`;
    const group = byPlayerAndAge.get(key);
    if (group) group.push(row);
    else byPlayerAndAge.set(key, [row]);
  }

  const suggestions: MergeSuggestion[] = [];

  for (const candidates of byPlayerAndAge.values()) {
    if (candidates.length < 2) continue;

    suggestions.push({
      fanId: candidates[0].fanId,
      ageGroup: candidates[0].ageGroup!.trim(),
      registrationIds: candidates.map(c => c.registrationId),
    });
  }

  return suggestions;
}

/** Every registration id named by a set of suggestions, for filtering the table. */
export function suggestedRegistrationIds(
  suggestions: readonly MergeSuggestion[],
): Set<string> {
  return new Set(suggestions.flatMap(s => s.registrationIds));
}
