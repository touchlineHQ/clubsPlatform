import { describe, it, expect } from 'vitest';
import {
  suggestMerges,
  suggestedRegistrationIds,
  type SuggestionRow,
} from '../../utils/mergeSuggestions';

const row = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  registrationId: 'reg_1',
  fanId: 'FAN-1',
  ageGroup: 'U15',
  billingRegistrationId: null,
  ...over,
});

describe('suggestMerges', () => {
  it('suggests two registrations of one player in the same age group', () => {
    const rows = [
      row({ registrationId: 'reg_1' }),
      row({ registrationId: 'reg_2' }),
    ];

    expect(suggestMerges(rows)).toEqual([
      { fanId: 'FAN-1', ageGroup: 'U15', registrationIds: ['reg_1', 'reg_2'] },
    ]);
  });

  it('does not suggest across different age groups', () => {
    // U18 plus Robins First is two commitments until the club says otherwise.
    const rows = [
      row({ registrationId: 'reg_1', ageGroup: 'U18' }),
      row({ registrationId: 'reg_2', ageGroup: 'Open' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('never suggests across players', () => {
    const rows = [
      row({ registrationId: 'reg_1', fanId: 'FAN-1' }),
      row({ registrationId: 'reg_2', fanId: 'FAN-2' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('says nothing about a set the admin has already ruled on', () => {
    // reg_2 is billed through reg_1; pulling reg_3 in would second-guess that.
    const rows = [
      row({
        registrationId: 'reg_1',
        billingRegistrationId: 'reg_1',
        mergedTeamNames: 'U15 Thursday',
      }),
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1' }),
      row({ registrationId: 'reg_3', billingRegistrationId: 'reg_3' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('excludes an existing primary before building suggestions', () => {
    const rows = [
      row({ registrationId: 'reg_primary', mergedTeamNames: 'U15 Thursday' }),
      row({ registrationId: 'reg_unmerged' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('excludes an existing secondary before building suggestions', () => {
    const rows = [
      row({ registrationId: 'reg_secondary', billingRegistrationId: 'reg_primary' }),
      row({ registrationId: 'reg_unmerged' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('suggests a whole set of three when none of them is merged', () => {
    const rows = [
      row({ registrationId: 'reg_1' }),
      row({ registrationId: 'reg_2' }),
      row({ registrationId: 'reg_3' }),
    ];

    const [suggestion] = suggestMerges(rows);
    expect(suggestion.registrationIds).toEqual(['reg_1', 'reg_2', 'reg_3']);
  });

  it('treats age groups case- and whitespace-insensitively', () => {
    // From an FA export, not a controlled vocabulary.
    const rows = [
      row({ registrationId: 'reg_1', ageGroup: 'U15' }),
      row({ registrationId: 'reg_2', ageGroup: ' u15 ' }),
    ];

    expect(suggestMerges(rows)).toHaveLength(1);
  });

  it('ignores registrations with no age group', () => {
    // No age group is no evidence, not a match with every other blank.
    const rows = [
      row({ registrationId: 'reg_1', ageGroup: null }),
      row({ registrationId: 'reg_2', ageGroup: '' }),
      row({ registrationId: 'reg_3', ageGroup: '   ' }),
    ];

    expect(suggestMerges(rows)).toEqual([]);
  });

  it('treats a missing billingRegistrationId as unmerged', () => {
    // The column is new; a row predating it is its own group.
    const rows = [
      { registrationId: 'reg_1', fanId: 'FAN-1', ageGroup: 'U15' },
      { registrationId: 'reg_2', fanId: 'FAN-1', ageGroup: 'U15' },
    ];

    expect(suggestMerges(rows)).toHaveLength(1);
  });

  it('returns nothing for an empty table', () => {
    expect(suggestMerges([])).toEqual([]);
  });

  it('reports several players separately', () => {
    const rows = [
      row({ registrationId: 'reg_1', fanId: 'FAN-1' }),
      row({ registrationId: 'reg_2', fanId: 'FAN-1' }),
      row({ registrationId: 'reg_3', fanId: 'FAN-2' }),
      row({ registrationId: 'reg_4', fanId: 'FAN-2' }),
    ];

    expect(suggestMerges(rows)).toHaveLength(2);
  });
});

describe('suggestedRegistrationIds', () => {
  it('flattens every id named by the suggestions', () => {
    const ids = suggestedRegistrationIds([
      { fanId: 'FAN-1', ageGroup: 'U15', registrationIds: ['reg_1', 'reg_2'] },
      { fanId: 'FAN-2', ageGroup: 'U7', registrationIds: ['reg_3'] },
    ]);

    expect([...ids].sort()).toEqual(['reg_1', 'reg_2', 'reg_3']);
  });

  it('is empty when there is nothing to suggest', () => {
    expect(suggestedRegistrationIds([]).size).toBe(0);
  });
});
