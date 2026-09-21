import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithMantine, mockMember, mockAdmin, mockSingleClub } from '../test-utils';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

// Modal and Tooltip use react-remove-scroll which has a dual-React conflict; stub them out.
vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Modal: ({ children, opened }: { children: React.ReactNode; opened: boolean }) =>
      opened ? <div data-testid="modal">{children}</div> : null,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

import { RegistrationsPage } from '../../pages/RegistrationsPage';

const sampleRow = {
  registrationId: 'reg_1',
  fanId: 'fan_1',
  teamName: 'First XI',
  registrationExpiry: '2025-08-01',
  registrationStatus: 'active',
  relationship: null,
  linkedAccounts: null,
  subscriptionLevelId: 'sub_1',
  subscriptionLevelName: 'Full Member',
  paymentStatus: 'active',
};

describe('RegistrationsPage', () => {
  /** Renders as an admin and switches to the Club Registrations tab. */
  async function renderClubTab(club: unknown[]) {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club, scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));
    // The team name also appears in the filter dropdown, so key off the
    // toolbar instead to know the club table has rendered.
    await waitFor(() => expect(screen.getByRole('button', { name: /Export to Excel/i })).toBeTruthy());
  }

  it('renders personal registrations returned by API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [sampleRow], club: null, scope: 'user' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('First XI')).toBeTruthy();
    });
  });

  it('shows admin club tab when scope is admin', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [sampleRow], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });
  });

  it('shows a loader while fetching', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows an error when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeTruthy();
    });
  });

  it('shows Export to Excel button next to Import Players in Club Registrations tab', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import Players/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Export to Excel/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Generate status report/i })).toBeTruthy();
    });
  });

  it('opens the status report panel from the Club Registrations tab', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    await renderClubTab([adminRow]);

    fireEvent.click(screen.getByRole('button', { name: /Generate status report/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download status report/i })).toBeTruthy();
    });
    // Nothing is generated until the admin picks a file.
    expect(screen.getByRole('button', { name: /Download status report/i })).toBeDisabled();
  });

  it('shows Import Players button in Club Registrations tab for admins', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import Players/i })).toBeTruthy();
    });
  });

  it('opens the delete modal when the remove button is clicked on a club registration', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      const removeBtn = document.querySelector('[aria-label="Remove registration"]');
      expect(removeBtn).toBeTruthy();
      fireEvent.click(removeBtn!);
    });

    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  // ─── Manual payment override ────────────────────────────────────────────────

  describe('manual payment override', () => {
    const outstandingRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves', paymentStatus: null };
    const manualRow = {
      ...outstandingRow,
      paymentStatus: 'manual',
      manualPaidBy: 'alice@club.com',
      manualPaidAt: 1755000000000,
      manualNote: 'cash at training',
    };

    it('shows a manually paid registration as Paid in full, with a marker for the admin', async () => {
      await renderClubTab([manualRow]);

      // Scoped to the table — "Paid in full" is also a filter option.
      const table = within(document.querySelector('table')!);
      expect(table.getByText('Paid in full')).toBeTruthy();
      expect(document.querySelector('[aria-label="Manually marked as paid"]')).toBeTruthy();
    });

    it('shows no marker to a player — a manual override looks like any other paid row', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ personal: [{ ...manualRow, relationship: 'self' }], club: null, scope: 'user' }),
      });

      renderWithMantine(<RegistrationsPage />, {
        authValue: mockMember,
        clubValue: mockSingleClub,
      });

      await waitFor(() => expect(screen.getByText('Paid in full')).toBeTruthy());
      expect(document.querySelector('[aria-label="Manually marked as paid"]')).toBeNull();
      expect(screen.queryByRole('button', { name: /Mark as paid/i })).toBeNull();
    });

    it.each([
      ['active', 'a live subscription'],
      ['completed', 'a plan collected in full'],
      ['pending', 'a live mandate'],
    ])('offers no override for %s — %s cannot be overridden', async (paymentStatus) => {
      await renderClubTab([{ ...outstandingRow, paymentStatus }]);
      expect(screen.queryByRole('button', { name: /Mark as paid/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Undo paid/i })).toBeNull();
    });

    it.each([
      ['completed', 'Paid in full'],
      ['active', 'Paying'],
      ['pending', 'Mandate set up'],
      ['inactive', 'Cancelled'],
      [null, 'Outstanding'],
    ])('badges %s as "%s"', async (paymentStatus, label) => {
      // The whole point of the change: a plan collected in full must not read
      // the same as one that stopped early, nor as one still collecting.
      await renderClubTab([{ ...outstandingRow, paymentStatus }]);
      expect(within(document.querySelector('table')!).getByText(label)).toBeTruthy();
    });

    it('separates a finished plan from one still collecting in the filter', async () => {
      await renderClubTab([
        { ...outstandingRow, registrationId: 'reg_done', fanId: 'FAN-DONE', paymentStatus: 'completed' },
        { ...outstandingRow, registrationId: 'reg_live', fanId: 'FAN-LIVE', paymentStatus: 'active' },
      ]);

      fireEvent.click(screen.getByRole('combobox', { name: /filter by subscription/i }));
      // The click has to happen inside the retry callback: Mantine closes the
      // dropdown a tick after it opens, so the option is gone by the time a
      // resolved waitFor hands control back. It still fires exactly once —
      // earlier attempts throw at the expect above it.
      await waitFor(() => {
        const option = screen.queryByRole('option', { name: 'Paying' });
        expect(option).toBeTruthy();
        fireEvent.click(option!);
      });

      await waitFor(() => {
        const table = within(document.querySelector('table')!);
        expect(table.getByText('FAN-LIVE')).toBeTruthy();
        expect(table.queryByText('FAN-DONE')).toBeNull();
      });
    });

    it('offers the override for a cancelled payment', async () => {
      await renderClubTab([{ ...outstandingRow, paymentStatus: 'inactive' }]);
      expect(screen.getByRole('button', { name: /Mark as paid/i })).toBeTruthy();
    });

    it('marks a registration as paid with a note', async () => {
      await renderClubTab([outstandingRow]);

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      const modal = screen.getByTestId('modal');

      fireEvent.change(within(modal).getByPlaceholderText(/cash at training/i), {
        target: { value: 'bank transfer ref 4471' },
      });
      fireEvent.click(within(modal).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ registrationId: 'reg_2', note: 'bank transfer ref 4471' }),
          }),
        );
      });
    });

    it('omits the note when none is typed', async () => {
      await renderClubTab([outstandingRow]);

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      fireEvent.click(within(screen.getByTestId('modal')).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment',
          expect.objectContaining({ body: JSON.stringify({ registrationId: 'reg_2' }) }),
        );
      });
    });

    it('surfaces the error when the server refuses the override', async () => {
      await renderClubTab([outstandingRow]);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'This registration has a live GoCardless payment — a manual override cannot be applied while it is in place.' }),
      });

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      fireEvent.click(within(screen.getByTestId('modal')).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(screen.getByText(/live GoCardless payment/i)).toBeTruthy();
      });
    });

    it('undoes a manual override', async () => {
      await renderClubTab([manualRow]);

      fireEvent.click(screen.getByRole('button', { name: /Undo paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment?registrationId=reg_2',
          expect.objectContaining({ method: 'DELETE' }),
        );
      });
    });

    it('shows an undo failure in the club content', async () => {
      await renderClubTab([manualRow]);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Could not undo this payment' }),
      });

      fireEvent.click(screen.getByRole('button', { name: /Undo paid/i }));

      await waitFor(() => {
        expect(screen.getByText('Could not undo this payment')).toBeTruthy();
      });
    });
  });

  // ─── Summary strip ──────────────────────────────────────────────────────────

  describe('summary strip', () => {
    // FAN-1 plays for two teams, so registrations (4) and players (3) differ.
    const summaryClub = [
      { ...sampleRow, registrationId: 'reg_1', fanId: 'FAN-1', teamName: 'First XI', paymentStatus: 'active' },
      { ...sampleRow, registrationId: 'reg_2', fanId: 'FAN-1', teamName: 'Reserves', paymentStatus: 'completed' },
      { ...sampleRow, registrationId: 'reg_3', fanId: 'FAN-2', teamName: 'First XI', paymentStatus: null },
      {
        ...sampleRow,
        registrationId: 'reg_4',
        fanId: 'FAN-3',
        teamName: 'Reserves',
        paymentStatus: null,
        subscriptionLevelId: null,
        subscriptionLevelName: null,
      },
    ];

    /** Reads a tile's number by its label — StatTile renders value and label as siblings. */
    function statValue(label: string): string {
      const strip = screen.getByRole('group', { name: /registrations summary/i });
      return within(strip).getByText(label).previousElementSibling?.textContent ?? '';
    }

    /** Picks an option from one of the filter Selects. */
    async function chooseFilter(filter: RegExp, option: string) {
      fireEvent.click(screen.getByRole('combobox', { name: filter }));
      // Click inside the retry: Mantine closes the dropdown a tick after it opens.
      await waitFor(() => {
        const opt = screen.queryByRole('option', { name: option });
        expect(opt).toBeTruthy();
        fireEvent.click(opt!);
      });
    }

    it('counts the club rows above the table', async () => {
      await renderClubTab(summaryClub);

      expect(statValue('Registrations')).toBe('4');
      expect(statValue('Players')).toBe('3');
      expect(statValue('Paying')).toBe('2');
      expect(statValue('Outstanding')).toBe('1');
      expect(statValue('No level assigned')).toBe('1');
    });

    it('recomputes when the team filter changes', async () => {
      await renderClubTab(summaryClub);

      await chooseFilter(/filter by team/i, 'Reserves');

      await waitFor(() => expect(statValue('Registrations')).toBe('2'));
      expect(statValue('Players')).toBe('2');
      expect(statValue('Paying')).toBe('1');
      expect(statValue('No level assigned')).toBe('1');
    });

    it('recomputes when the subscription status filter changes', async () => {
      await renderClubTab(summaryClub);

      await chooseFilter(/filter by subscription/i, 'Paying');

      await waitFor(() => expect(statValue('Registrations')).toBe('1'));
      expect(statValue('Paying')).toBe('1');
      expect(statValue('Outstanding')).toBe('0');
    });

    it('renders zeroes rather than blanks when no row matches the filters', async () => {
      await renderClubTab(summaryClub);

      await chooseFilter(/filter by subscription/i, 'Cancelled');

      await waitFor(() => expect(statValue('Registrations')).toBe('0'));
      for (const label of ['Players', 'Paying', 'Outstanding', 'No level assigned']) {
        expect(statValue(label)).toBe('0');
      }
      expect(screen.getByText(/No registrations match the current filters/i)).toBeTruthy();
    });

    it('makes no further network calls when the filters change', async () => {
      await renderClubTab(summaryClub);
      const callsAfterLoad = mockFetch.mock.calls.length;

      await chooseFilter(/filter by team/i, 'Reserves');
      await waitFor(() => expect(statValue('Registrations')).toBe('2'));

      expect(mockFetch.mock.calls.length).toBe(callsAfterLoad);
    });

    it('leaves the empty state alone when the club has no registrations', async () => {
      await renderClubTab([]);

      expect(screen.queryByRole('group', { name: /registrations summary/i })).toBeNull();
      expect(screen.getByText(/No registrations yet for this club/i)).toBeTruthy();
    });
  });

  // ── Merging registrations ──────────────────────────────────────────────────

  describe('merging registrations', () => {
    /** Two registrations of one player, same age group, each billed on its own. */
    const tuesday = {
      ...sampleRow,
      registrationId: 'reg_tue',
      teamName: 'U15 Tuesday',
      ageGroup: 'U15',
      billingRegistrationId: 'reg_tue',
      billedWithTeamName: null,
      mergedTeamNames: null,
      paymentStatus: null,
    };
    const thursday = {
      ...tuesday,
      registrationId: 'reg_thu',
      teamName: 'U15 Thursday',
      billingRegistrationId: 'reg_thu',
    };

    function statValue(label: string): string {
      const strip = screen.getByRole('group', { name: /registrations summary/i });
      return within(strip).getByText(label).previousElementSibling?.textContent ?? '';
    }

    it('suggests same-age-group registrations without merging anything itself', async () => {
      await renderClubTab([tuesday, thursday]);

      expect(screen.getByText(/1 player has registrations in the same age group/i)).toBeTruthy();
      // A hint, not a decision: nothing is billed together yet.
      expect(statValue('Billable units')).toBe('2');
    });

    it('says nothing when the age groups differ', async () => {
      // U18 plus Robins First is two commitments until the club says otherwise.
      await renderClubTab([
        tuesday,
        { ...thursday, ageGroup: 'Open', teamName: 'Robins First' },
      ]);

      expect(screen.queryByText(/same age group/i)).toBeNull();
    });

    it('counts a merged group as one billable unit but two registrations', async () => {
      await renderClubTab([
        { ...tuesday, mergedTeamNames: 'U15 Thursday' },
        { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
      ]);

      expect(statValue('Registrations')).toBe('2');
      expect(statValue('Billable units')).toBe('1');
      // Already ruled on, so no nagging.
      expect(screen.queryByText(/same age group/i)).toBeNull();
    });

    it('explains on the row why a merged registration reads as paid', async () => {
      await renderClubTab([
        { ...tuesday, paymentStatus: 'active', mergedTeamNames: 'U15 Thursday' },
        {
          ...thursday,
          paymentStatus: 'active',
          billingRegistrationId: 'reg_tue',
          billedWithTeamName: 'U15 Tuesday',
        },
      ]);

      expect(screen.getByText('Billed with U15 Tuesday')).toBeTruthy();
      expect(screen.getByText('Billed for 2 teams')).toBeTruthy();
    });

    it('offers Unmerge on the primary only', async () => {
      await renderClubTab([
        { ...tuesday, mergedTeamNames: 'U15 Thursday' },
        { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
      ]);

      expect(screen.getAllByRole('button', { name: /^Unmerge$/ })).toHaveLength(1);
    });

    it('hides Mark as paid on a secondary — the override belongs on the primary', async () => {
      await renderClubTab([
        tuesday,
        { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
      ]);

      expect(screen.getAllByRole('button', { name: /Mark as paid/i })).toHaveLength(1);
    });

    it('enables Merge once two registrations of one player are selected', async () => {
      await renderClubTab([tuesday, thursday]);

      fireEvent.click(screen.getByLabelText('Select U15 Tuesday for merging'));
      await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
      // One is not a group.
      expect(screen.getByRole('button', { name: /Merge registrations/i })
        .hasAttribute('disabled')).toBe(true);

      fireEvent.click(screen.getByLabelText('Select U15 Thursday for merging'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Merge registrations/i })
          .hasAttribute('disabled')).toBe(false);
      });
    });

    it('refuses to merge across players, and says why before the API does', async () => {
      await renderClubTab([
        tuesday,
        { ...thursday, fanId: 'fan_other' },
      ]);

      fireEvent.click(screen.getByLabelText('Select U15 Tuesday for merging'));
      fireEvent.click(screen.getByLabelText('Select U15 Thursday for merging'));

      await waitFor(() => {
        expect(screen.getByText(/one player at a time/i)).toBeTruthy();
      });
      expect(screen.getByRole('button', { name: /Merge registrations/i })
        .hasAttribute('disabled')).toBe(true);
    });

    it('posts the chosen primary and refreshes', async () => {
      await renderClubTab([tuesday, thursday]);

      fireEvent.click(screen.getByLabelText('Select U15 Tuesday for merging'));
      fireEvent.click(screen.getByLabelText('Select U15 Thursday for merging'));
      await waitFor(() => expect(screen.getByText('2 selected')).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: /Merge registrations/i }));
      await waitFor(() => expect(screen.getByTestId('modal')).toBeTruthy());

      // The POST, then the refresh it triggers.
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            personal: [],
            club: [
              { ...tuesday, mergedTeamNames: 'U15 Thursday' },
              { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
            ],
            scope: 'admin',
          }),
        });
      fireEvent.click(within(screen.getByTestId('modal')).getByRole('button', { name: /^Merge$/ }));

      await waitFor(() => {
        const call = mockFetch.mock.calls.find(
          c => String(c[0]).includes('/api/admin/registration-merges'),
        );
        expect(call).toBeTruthy();
        expect(call![1].method).toBe('POST');
        expect(JSON.parse(call![1].body)).toEqual({
          primaryRegistrationId: 'reg_tue',
          registrationIds: ['reg_tue', 'reg_thu'],
        });
      });
    });

    it('defaults the primary to the registration that has a level', async () => {
      // A primary without a level would render a dead card for a payable player.
      await renderClubTab([
        { ...tuesday, subscriptionLevelId: null, subscriptionLevelName: null },
        thursday,
      ]);

      fireEvent.click(screen.getByLabelText('Select U15 Tuesday for merging'));
      fireEvent.click(screen.getByLabelText('Select U15 Thursday for merging'));
      await waitFor(() => expect(screen.getByText('2 selected')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: /Merge registrations/i }));

      await waitFor(() => {
        const chosen = within(screen.getByTestId('modal'))
          .getByRole('radio', { checked: true }) as HTMLInputElement;
        expect(chosen.value).toBe('reg_thu');
      });
    });

    it('surfaces the API‘s refusal rather than pretending it worked', async () => {
      await renderClubTab([
        { ...tuesday, mergedTeamNames: 'U15 Thursday' },
        { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
      ]);

      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'This group has a live GoCardless payment.' }),
      });
      fireEvent.click(screen.getByRole('button', { name: /^Unmerge$/ }));

      await waitFor(() => {
        expect(screen.getByText(/live GoCardless payment/i)).toBeTruthy();
      });
    });

    it('warns before removing a registration others are billed through', async () => {
      await renderClubTab([
        { ...tuesday, mergedTeamNames: 'U15 Thursday' },
        { ...thursday, billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday' },
      ]);

      // Rows sort by team name, so pick the primary by the badge only it carries.
      const primaryRow = screen.getByText('Billed for 2 teams').closest('tr')!;
      fireEvent.click(within(primaryRow).getByRole('button', { name: /Remove registration/i }));

      await waitFor(() => {
        expect(within(screen.getByTestId('modal')).getByText(/unmerge first/i)).toBeTruthy();
      });
    });
  });

  it('shows "No registrations linked to your account yet" when personal is empty and scope is user', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: null, scope: 'user' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/No registrations linked to your account yet/i)).toBeTruthy();
    });
  });
});
