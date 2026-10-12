import { describe, it, expect } from 'vitest';
import { breakdownByTeam, isExpiryCurrent } from '../../utils/teamBreakdown';
import { summariseRegistrations } from '../../utils/registrationSummary';

const NOW = Date.UTC(2026, 9, 12);
const row = (o: Record<string, unknown>) => ({
  registrationId: 'r', fanId: 'f', teamName: 'U10', registrationStatus: 'Active',
  registrationExpiry: null, subscriptionLevelId: 'lvl', overrideLevelId: null, paymentStatus: 'active', ...o,
});

describe('breakdownByTeam', () => {
  it('returns nothing for an empty club', () => {
    expect(breakdownByTeam([], NOW)).toEqual([]);
  });

  it('counts league, training, issues and money per team, sorted by name', () => {
    const rows = [
      row({ registrationId: 'a', fanId: '1', teamName: 'U12' }),
      row({ registrationId: 'b', fanId: '2', teamName: 'U12', registrationStatus: 'Training Only', paymentStatus: null }),
      row({ registrationId: 'c', fanId: '2', teamName: 'U12', registrationStatus: 'cancelled', subscriptionLevelId: null, paymentStatus: null }),
      row({ registrationId: 'd', fanId: '3', teamName: 'U9', registrationExpiry: '2026-01-01', paymentStatus: 'completed' }),
      row({ registrationId: 'e', fanId: '4', teamName: '  ' }),
    ];
    const out = breakdownByTeam(rows, NOW);
    expect(out.map(t => t.teamName)).toEqual(['(No team)', 'U9', 'U12']);
    const u12 = out[2];
    expect(u12).toMatchObject({
      league: 1, training: 1, registrations: 3, players: 2, paying: 1, outstanding: 1, noLevel: 1, issues: 1,
    });
    expect(out[1]).toMatchObject({ league: 1, paying: 1, outstanding: 0, issues: 1 });
  });

  it('matches summariseRegistrations for each team, including billing groups', () => {
    const rows = [
      row({ registrationId: 'p', fanId: '1', paymentStatus: null }),
      row({ registrationId: 'm', fanId: '2', billingRegistrationId: 'p', paymentStatus: null }),
    ];
    const [t] = breakdownByTeam(rows, NOW);
    const { registrations, players, billableUnits, paying, outstanding, noLevel } = t;
    expect({ registrations, players, billableUnits, paying, outstanding, noLevel }).toEqual(summariseRegistrations(rows));
    expect(t.outstanding).toBe(1);
  });
});

describe('breakdownByTeam with configured teams', () => {
  it('seeds zero rows without duplicating registered teams', () => {
    const out = breakdownByTeam([row({ teamName: 'U10' })], NOW, ['U8', ' U10 ', '']);
    expect(out.map(t => [t.teamName, t.registrations])).toEqual([['U8', 0], ['U10', 1]]);
    expect(out[0]).toMatchObject({ league: 0, paying: 0, outstanding: 0, issues: 0, players: 0 });
  });
});

describe('isExpiryCurrent', () => {
  it.each([
    [null, true], ['', true], ['2026-10-12', true], ['12/10/2026', true],
    ['2026-10-11', false], ['2026-02-30', false], ['nonsense', false], ['1-1-2027', true],
  ])('%s -> %s', (v, want) => {
    expect(isExpiryCurrent(v as string | null, NOW)).toBe(want);
  });
  it('defaults to now', () => {
    expect(isExpiryCurrent('2999-01-01')).toBe(true);
  });
});
