import { describe, it, expect } from 'vitest';
import {
  buildStatusReport,
  joinKey,
  normaliseTeam,
  summariseStatusReport,
  toSheetRows,
  STATUS_REPORT_COLUMNS,
  type StatusReportFaRow,
  type StatusReportRegistration,
} from '../../utils/statusReport';

/** An FA row with sensible defaults, overridden per case. */
const fa = (over: Partial<StatusReportFaRow> = {}): StatusReportFaRow => ({
  fanId: 'FAN001',
  teamName: 'U15 Reds',
  firstNames: 'Ada',
  surname: 'Lovelace',
  dateOfBirth: '04/11/2009',
  ageGroup: 'U15',
  registrationStatus: 'Active',
  registrationExpiry: '01/08/2026',
  ...over,
});

/** A club registration with sensible defaults, overridden per case. */
const reg = (over: Partial<StatusReportRegistration> = {}): StatusReportRegistration => ({
  fanId: 'FAN001',
  teamName: 'U15 Reds',
  registrationStatus: 'active',
  registrationExpiry: '2026-08-01',
  subscriptionLevelName: 'Full Member',
  paymentStatus: 'active',
  ...over,
});

describe('normaliseTeam and joinKey', () => {
  it('collapses internal whitespace and case', () => {
    expect(normaliseTeam('  U15 Bantams   Blue ')).toBe('u15 bantams blue');
  });

  it('keys on FAN ID and team together, not FAN ID alone', () => {
    expect(joinKey('FAN001', 'U15 Reds')).not.toBe(joinKey('FAN001', 'U18 Reds'));
    expect(joinKey(' FAN001 ', 'U15  Reds')).toBe(joinKey('FAN001', 'u15 reds'));
  });
});

describe('buildStatusReport', () => {
  it('gives a four-team player four rows rather than collapsing them', () => {
    const teams = ['U18 Reds', 'Robins First', 'Robins Reserves', 'U18 Blues'];
    const rows = buildStatusReport(
      teams.map(t => fa({ teamName: t })),
      teams.map(t => reg({ teamName: t })),
    );

    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.match === 'Matched')).toBe(true);
    expect(new Set(rows.map(r => r.team))).toEqual(new Set(teams));
  });

  it('keeps each team of a multi-team player on its own subscription status', () => {
    // The real case the Sheets formula got wrong: one status shown against both teams.
    const rows = buildStatusReport(
      [fa({ teamName: 'U18 Reds' }), fa({ teamName: 'Robins First' })],
      [
        reg({ teamName: 'U18 Reds', paymentStatus: 'active' }),
        reg({ teamName: 'Robins First', paymentStatus: 'completed' }),
      ],
    );

    const byTeam = Object.fromEntries(rows.map(r => [r.team, r.subscriptionStatus]));
    expect(byTeam['U18 Reds']).toBe('Paying');
    expect(byTeam['Robins First']).toBe('Paid in full');
  });

  it('matches team names that differ only by an internal double space', () => {
    const rows = buildStatusReport(
      [fa({ teamName: 'East Leake FC U15 Bantams  Blue' })],
      [reg({ teamName: 'East Leake FC U15 Bantams Blue' })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].match).toBe('Matched');
    expect(rows[0].surname).toBe('Lovelace');
  });

  it('excludes Cancelled and Transferred FA rows by default', () => {
    const rows = buildStatusReport(
      [
        fa({ fanId: 'FAN002', teamName: 'U15 Reds', registrationStatus: 'Cancelled' }),
        fa({ fanId: 'FAN003', teamName: 'U15 Reds', registrationStatus: 'Transferred' }),
      ],
      [],
    );

    expect(rows).toEqual([]);
  });

  it('includes them when the flag is set', () => {
    const rows = buildStatusReport(
      [fa({ fanId: 'FAN002', registrationStatus: 'cancelled' })],
      [],
      { includeCancelled: true },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].match).toBe('No subs record');
    expect(rows[0].registrationStatus).toBe('cancelled');
  });

  it('classifies a registration with no FA row as Subs only', () => {
    const rows = buildStatusReport([], [reg()]);

    expect(rows[0]).toMatchObject({
      match: 'Subs only',
      fanId: 'FAN001',
      team: 'U15 Reds',
      firstNames: '',
      surname: '',
      dateOfBirth: '',
      ageGroup: '',
      subscriptionStatus: 'Paying',
    });
    // No FA row, so the stored values stand.
    expect(rows[0].registrationExpiry).toBe('2026-08-01');
  });

  it('classifies an FA row with no registration as No subs record', () => {
    const rows = buildStatusReport([fa()], [], { paymentLink: id => `https://x.test/pay/${id}` });

    expect(rows[0]).toMatchObject({
      match: 'No subs record',
      surname: 'Lovelace',
      dateOfBirth: '04/11/2009',
      ageGroup: 'U15',
      subscriptionLevel: '',
      subscriptionStatus: '',
      markedPaidBy: '',
    });
    // The chase list is the point of the report, so the link is still there.
    expect(rows[0].paymentLink).toBe('https://x.test/pay/FAN001');
  });

  it('prefers the FA file for registration status and expiry when matched', () => {
    const rows = buildStatusReport(
      [fa({ registrationStatus: 'Active', registrationExpiry: '01/08/2027' })],
      [reg({ registrationStatus: 'stale', registrationExpiry: '2025-08-01' })],
    );

    expect(rows[0].registrationStatus).toBe('Active');
    expect(rows[0].registrationExpiry).toBe('01/08/2027');
  });

  it('carries the manual override attribution through', () => {
    const rows = buildStatusReport(
      [fa()],
      [reg({ paymentStatus: 'manual', manualPaidBy: 'Treasurer' })],
    );

    expect(rows[0].subscriptionStatus).toBe('Paid in full');
    expect(rows[0].markedPaidBy).toBe('Treasurer');
  });

  it('takes the first FA row on a duplicate FAN and team', () => {
    const rows = buildStatusReport(
      [fa({ surname: 'Lovelace' }), fa({ surname: 'Duplicate' })],
      [reg()],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].surname).toBe('Lovelace');
  });

  it('sorts by team, then surname, with blank surnames last', () => {
    const rows = buildStatusReport(
      [
        fa({ fanId: 'FAN002', teamName: 'U15 Reds', surname: 'Babbage' }),
        fa({ fanId: 'FAN001', teamName: 'U15 Reds', surname: 'Lovelace' }),
      ],
      [reg({ fanId: 'FAN003', teamName: 'U15 Reds' }), reg({ fanId: 'FAN004', teamName: 'U11 Blues' })],
    );

    expect(rows.map(r => [r.team, r.surname])).toEqual([
      ['U11 Blues', ''],
      ['U15 Reds', 'Babbage'],
      ['U15 Reds', 'Lovelace'],
      ['U15 Reds', ''],
    ]);
  });

  describe('page filters', () => {
    it('restricts FA-only rows to the filtered team', () => {
      const rows = buildStatusReport(
        [fa({ teamName: 'U15 Reds' }), fa({ fanId: 'FAN002', teamName: 'U18 Blues' })],
        [],
        { faFilter: { team: 'U15 Reds' } },
      );

      expect(rows.map(r => r.team)).toEqual(['U15 Reds']);
    });

    it('restricts FA-only rows to the filtered registration status', () => {
      const rows = buildStatusReport(
        [fa({ registrationStatus: 'Active' }), fa({ fanId: 'FAN002', registrationStatus: 'Pending' })],
        [],
        { faFilter: { registrationStatus: 'Pending' } },
      );

      expect(rows.map(r => r.fanId)).toEqual(['FAN002']);
    });

    it('keeps matched FA details when only the registration satisfies the page filter', () => {
      const rows = buildStatusReport(
        [fa({ registrationStatus: 'Active' })],
        [reg({ registrationStatus: 'Pending' })],
        { faFilter: { registrationStatus: 'Pending' } },
      );

      expect(rows[0]).toMatchObject({
        match: 'Matched',
        surname: 'Lovelace',
        registrationStatus: 'Active',
      });
    });

    it('drops FA-only rows entirely when a subscription filter is active', () => {
      // No registration means no subscription status for such a filter to match.
      const rows = buildStatusReport(
        [fa({ fanId: 'FAN002', teamName: 'U15 Reds' }), fa()],
        [reg()],
        { faFilter: { dropFaOnly: true } },
      );

      expect(rows.map(r => r.match)).toEqual(['Matched']);
    });
  });
});

describe('summariseStatusReport', () => {
  it('counts each classification and the total', () => {
    const rows = buildStatusReport(
      [fa(), fa({ fanId: 'FAN002', teamName: 'U18 Blues' })],
      [reg(), reg({ fanId: 'FAN003', teamName: 'U11 Greens' })],
    );

    expect(summariseStatusReport(rows)).toEqual({
      rowCount: 3,
      matched: 1,
      noSubsRecord: 1,
      subsOnly: 1,
    });
  });
});

describe('toSheetRows', () => {
  it('emits the thirteen headers in spec order, Match first', () => {
    const rows = toSheetRows(buildStatusReport([fa()], [reg()]));

    expect(Object.keys(rows[0])).toEqual([
      'Match', 'FAN ID', 'Team', 'First names', 'Surname', 'Date of birth', 'Age group',
      'Registration status', 'Registration expiry', 'Subscription level',
      'Subscription status', 'Marked paid by', 'Payment link',
    ]);
    expect(STATUS_REPORT_COLUMNS).toHaveLength(13);
  });

  it('writes the date of birth as a string, never an Excel serial', () => {
    const rows = toSheetRows(buildStatusReport([fa()], [reg()]));

    expect(rows[0]['Date of birth']).toBe('04/11/2009');
    expect(typeof rows[0]['Date of birth']).toBe('string');
  });
});
