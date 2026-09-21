/** Structural, so the page's own row type satisfies it. */
export interface SuggestionRow {
  registrationId: string;
  fanId: string;
  ageGroup?: string | null;
  /** The registration this one is billed through — itself, unless merged. */
  billingRegistrationId?: string | null;
}

export interface MergeSuggestion {
  fanId: string;
  ageGroup: string;
  registrationIds: string[];
}

/** The billing group a row belongs to; its own id when it is not merged. */
function billingIdOf(row: SuggestionRow): string {
  return row.billingRegistrationId || row.registrationId;
}

/** Case- and whitespace-insensitive, since age groups arrive from an FA export. */
function normaliseAgeGroup(ageGroup: string): string {
  return ageGroup.trim().toLowerCase();
}

/**
 * Registrations that look like they should be billed together but are not.
 *
 * Same player, same age group is a *hint*, nothing more. It is wrong often
 * enough that it must never be stored or acted on automatically: U18 Blue and
 * U18 Purple share an age group and are two separate sets of subs, while U15s
 * on different days are two registrations the club bills once. Only the club
 * knows which. So this surfaces candidates and stops there — the merge itself is
 * always an explicit decision, recorded in registration_merge and audited.
 *
 * A pair is suggested only when every member is currently billed separately.
 * Once an admin has merged two of three same-age-group registrations, the group
 * is a decision already made, and nagging about the third would be second-
 * guessing it.
 */
export function suggestMerges(rows: readonly SuggestionRow[]): MergeSuggestion[] {
  const byPlayerAndAge = new Map<string, SuggestionRow[]>();

  for (const row of rows) {
    if (!row.ageGroup?.trim()) continue;
    const key = `${row.fanId}\u0000${normaliseAgeGroup(row.ageGroup)}`;
    const group = byPlayerAndAge.get(key);
    if (group) group.push(row);
    else byPlayerAndAge.set(key, [row]);
  }

  const suggestions: MergeSuggestion[] = [];

  for (const candidates of byPlayerAndAge.values()) {
    if (candidates.length < 2) continue;

    // Every candidate must still be its own billing group. If any share one,
    // the admin has already ruled on this set.
    const billingIds = new Set(candidates.map(billingIdOf));
    if (billingIds.size !== candidates.length) continue;

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
