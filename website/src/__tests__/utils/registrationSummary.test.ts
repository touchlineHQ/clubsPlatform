import { describe, it, expect } from 'vitest';
import { summariseRegistrations, type SummaryRow } from '../../utils/registrationSummary';

let nextId = 0;
/** Distinct ids by default: every row is its own billing unit unless told otherwise. */
const row = (over: Partial<SummaryRow> = {}): SummaryRow => ({
  registrationId: `reg_${++nextId}`,
  fanId: 'FAN-1',
  paymentStatus: 'active',
  subscriptionLevelId: 'sub_1',
  overrideLevelId: null,
  ...over,
});

describe('summariseRegistrations', () => {
  it('counts a mixed set of rows', () => {
    const rows = [
      row({ fanId: 'FAN-1', paymentStatus: 'active' }),
      row({ fanId: 'FAN-2', paymentStatus: 'completed' }),
      row({ fanId: 'FAN-3', paymentStatus: null }),
      row({ fanId: 'FAN-4', paymentStatus: null, subscriptionLevelId: null }),
    ];

    expect(summariseRegistrations(rows)).toEqual({
      registrations: 4,
      players: 4,
      billableUnits: 4,
      paying: 2,
      outstanding: 1,
      noLevel: 1,
    });
  });

  it('counts a multi-team player once as a player and once per registration', () => {
    // Counting registrations as people is what reported 31 U18s against 40.
    const rows = [
      row({ fanId: 'FAN-1', subscriptionLevelId: 'sub_1' }),
      row({ fanId: 'FAN-1', subscriptionLevelId: 'sub_2' }),
      row({ fanId: 'FAN-2' }),
    ];

    const summary = summariseRegistrations(rows);
    expect(summary.registrations).toBe(3);
    expect(summary.players).toBe(2);
  });

  it.each([['completed'], ['manual'], ['active']])('counts %s as paying', (paymentStatus) => {
    expect(summariseRegistrations([row({ paymentStatus })]).paying).toBe(1);
  });

  it.each([['pending'], ['inactive'], [null]])('does not count %s as paying', (paymentStatus) => {
    // 'pending' is the one a reader assumes wrong: a mandate alone collects nothing.
    const summary = summariseRegistrations([row({ paymentStatus })]);
    expect(summary.paying).toBe(0);
    expect(summary.outstanding).toBe(1);
  });

  it('counts a row carrying only an override as having a level', () => {
    const summary = summariseRegistrations([
      row({ paymentStatus: null, subscriptionLevelId: null, overrideLevelId: 'sub_9' }),
    ]);
    expect(summary.outstanding).toBe(1);
    expect(summary.noLevel).toBe(0);
  });

  it('keeps an unpaid row with no level out of outstanding — nobody can chase it yet', () => {
    const summary = summariseRegistrations([
      row({ paymentStatus: null, subscriptionLevelId: null }),
    ]);
    expect(summary.noLevel).toBe(1);
    expect(summary.outstanding).toBe(0);
  });

  it('counts a paid row with no level in both paying and no level assigned', () => {
    // Deliberate overlap: the money is real, the missing level still needs fixing.
    const summary = summariseRegistrations([
      row({ paymentStatus: 'completed', subscriptionLevelId: null }),
    ]);
    expect(summary.paying).toBe(1);
    expect(summary.noLevel).toBe(1);
    expect(summary.outstanding).toBe(0);
  });

  it('accounts for every row exactly once across the three level buckets', () => {
    const rows = [
      row({ fanId: 'FAN-1', paymentStatus: 'active' }),
      row({ fanId: 'FAN-2', paymentStatus: 'pending' }),
      row({ fanId: 'FAN-3', paymentStatus: 'completed', subscriptionLevelId: null }),
      row({ fanId: 'FAN-4', paymentStatus: null, subscriptionLevelId: null }),
    ];

    const s = summariseRegistrations(rows);
    const payingWithLevel = rows.filter(
      r => r.subscriptionLevelId && (r.paymentStatus === 'active' || r.paymentStatus === 'completed'),
    ).length;
    expect(payingWithLevel + s.outstanding + s.noLevel).toBe(s.registrations);
  });

  // ── Merged registrations ───────────────────────────────────────────────────

  it('counts a merged group as one billable unit and one outstanding', () => {
    // One set of subs owed; reporting two had the treasurer chasing twice.
    const rows = [
      row({ registrationId: 'reg_1', billingRegistrationId: 'reg_1', paymentStatus: null }),
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1', paymentStatus: null }),
      row({ registrationId: 'reg_3', billingRegistrationId: 'reg_1', paymentStatus: null }),
    ];

    const s = summariseRegistrations(rows);
    expect(s.registrations).toBe(3);
    expect(s.players).toBe(1);
    expect(s.billableUnits).toBe(1);
    expect(s.outstanding).toBe(1);
  });

  it('counts a merged group as paying once when its primary has paid', () => {
    const rows = [
      row({ registrationId: 'reg_1', billingRegistrationId: 'reg_1', paymentStatus: 'active' }),
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1', paymentStatus: 'active' }),
    ];

    const s = summariseRegistrations(rows);
    expect(s.paying).toBe(1);
    expect(s.outstanding).toBe(0);
  });

  it('prices a group off its primary, not whichever member came first', () => {
    // Reading the group's level off the secondary's would report the wrong one.
    const rows = [
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1', subscriptionLevelId: 'sub_2', paymentStatus: null }),
      row({ registrationId: 'reg_1', billingRegistrationId: 'reg_1', subscriptionLevelId: null, paymentStatus: null }),
    ];

    const s = summariseRegistrations(rows);
    expect(s.billableUnits).toBe(1);
    expect(s.noLevel).toBe(1);
    expect(s.outstanding).toBe(0);
  });

  it('still counts a group whose primary a filter has hidden', () => {
    // Dropping it would silently understate what the club is owed.
    const rows = [
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1', paymentStatus: null }),
    ];

    const s = summariseRegistrations(rows);
    expect(s.registrations).toBe(1);
    expect(s.billableUnits).toBe(1);
    expect(s.outstanding).toBe(1);
  });

  it('separates registrations from billable units, which is the whole point', () => {
    const rows = [
      row({ registrationId: 'reg_1', billingRegistrationId: 'reg_1' }),
      row({ registrationId: 'reg_2', billingRegistrationId: 'reg_1' }),
      row({ registrationId: 'reg_3', billingRegistrationId: 'reg_3', fanId: 'FAN-2' }),
    ];

    const s = summariseRegistrations(rows);
    expect(s.registrations).toBe(3);
    expect(s.billableUnits).toBe(2);
    expect(s.registrations).not.toBe(s.billableUnits);
  });

  it('returns zeroes for an empty set rather than blanks or NaN', () => {
    expect(summariseRegistrations([])).toEqual({
      registrations: 0,
      players: 0,
      billableUnits: 0,
      paying: 0,
      outstanding: 0,
      noLevel: 0,
    });
  });
});
