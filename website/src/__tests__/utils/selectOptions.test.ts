import { describe, it, expect } from 'vitest';
import { dedupeOptions } from '../../utils/selectOptions';

describe('dedupeOptions', () => {
  it('dedupes plain strings, keeping the first occurrence and order', () => {
    expect(dedupeOptions(['teversal', 'ac-united', 'teversal'])).toEqual(['teversal', 'ac-united']);
  });

  it('dedupes { value, label } items by value', () => {
    const data = [
      { value: 'a', label: 'First' },
      { value: 'b', label: 'Second' },
      { value: 'a', label: 'Duplicate of first' },
    ];
    expect(dedupeOptions(data)).toEqual([
      { value: 'a', label: 'First' },
      { value: 'b', label: 'Second' },
    ]);
  });

  it('dedupes across groups, since Mantine validates groups against one value set', () => {
    const data = [
      { group: 'Your Teams', items: [{ value: 'defined:t1|U12', label: 'U12 (coach)' }] },
      { group: 'Juniors', items: [{ value: 'defined:t1|U12', label: 'U12' }, { value: 'defined:t2|U14', label: 'U14' }] },
    ];
    expect(dedupeOptions(data)).toEqual([
      { group: 'Your Teams', items: [{ value: 'defined:t1|U12', label: 'U12 (coach)' }] },
      { group: 'Juniors', items: [{ value: 'defined:t2|U14', label: 'U14' }] },
    ]);
  });

  it('drops groups that are left empty so no bare heading renders', () => {
    const data = [
      { group: 'Your Teams', items: [{ value: 'x', label: 'X' }] },
      { group: 'Juniors', items: [{ value: 'x', label: 'X again' }] },
    ];
    expect(dedupeOptions(data)).toEqual([
      { group: 'Your Teams', items: [{ value: 'x', label: 'X' }] },
    ]);
  });

  it('does not mutate the input', () => {
    const group = { group: 'G', items: [{ value: 'a', label: 'A' }, { value: 'a', label: 'A2' }] };
    const data = [group];
    dedupeOptions(data);
    expect(group.items).toHaveLength(2);
    expect(data).toHaveLength(1);
  });

  it('leaves already-unique data untouched', () => {
    const data = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    expect(dedupeOptions(data)).toEqual(data);
  });

  it('handles an empty list', () => {
    expect(dedupeOptions([])).toEqual([]);
  });

  it('treats strings and item values as the same namespace', () => {
    // Mantine flattens both into one value set, so this must too.
    expect(dedupeOptions(['a', { value: 'a', label: 'A' }])).toEqual(['a']);
  });
});
