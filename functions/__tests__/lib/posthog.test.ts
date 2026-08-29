import { describe, it, expect } from 'vitest';
import { clubGroups } from '../../lib/posthog';

describe('clubGroups()', () => {
  it('returns a club group for a slug', () => {
    expect(clubGroups('east-leake-fc')).toEqual({ groups: { club: 'east-leake-fc' } });
  });

  // Absent rather than null: PostHog would otherwise record a group membership
  // of "null", creating a bogus club that shows up in every breakdown.
  it('omits the key entirely when there is no slug', () => {
    for (const empty of [null, undefined, '']) {
      const result = clubGroups(empty);
      expect(result).toEqual({});
      expect('groups' in result).toBe(false);
    }
  });

  it('spreads cleanly into a capture payload', () => {
    const withClub = {
      distinctId: 'u1',
      event: 'club registered',
      ...clubGroups('east-leake-fc'),
      properties: { club_name: 'East Leake FC' },
    };
    expect(withClub).toMatchObject({
      event: 'club registered',
      groups: { club: 'east-leake-fc' },
    });

    const withoutClub = {
      distinctId: 'u1',
      event: 'gc payment created',
      ...clubGroups(null),
      properties: {},
    };
    expect(withoutClub).not.toHaveProperty('groups');
  });
});
