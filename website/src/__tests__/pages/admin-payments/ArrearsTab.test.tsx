import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';
import { ArrearsTab } from '../../../pages/admin-payments/ArrearsTab';

vi.mock('../../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const row = {
  registrationId: 'reg-1', fanId: '12345', teamName: 'U12 Blues', registeredAt: 1_700_000_000_000,
  subscriptionLevelName: 'Junior', reason: 'failed_payment', failedAt: 1_700_000_000_000,
  failureCause: 'insufficient_funds', reachableContacts: 1, objectedContacts: 1, pendingContacts: 0,
  unreachableContacts: 0, lastChasedAt: null, chaseCount: 0,
};

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/registration-facets')) return new Response(JSON.stringify({ teams: ['U12 Blues'] }));
    if (url.startsWith('/api/admin/arrears-reminders')) {
      return new Response(JSON.stringify({ results: [{ registrationId: 'reg-1', sent: 1, dropped: [{}], mailConfigured: true }] }));
    }
    return new Response(JSON.stringify({ rows: [row], truncated: false }));
  });
});

describe('ArrearsTab (#77)', () => {
  it('shows a failed Direct Debit, the excluded contacts, and sends a reminder for the selection', async () => {
    renderWithMantine(<ArrearsTab clubHeaders={{ 'X-Club-Slug': 'test-club' }} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    expect(await screen.findByText('Direct Debit failed')).toBeTruthy();
    expect(screen.getByText('Excluded: 1 objected to club emails')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Select 12345'));
    fireEvent.click(screen.getByRole('button', { name: /Send reminder \(1\)/ }));

    await waitFor(() => expect(screen.getByText(/Reminders sent to 1 contact for 1 registration; 1 excluded/)).toBeTruthy());
    const post = mockFetch.mock.calls.find(([u, init]) => u === '/api/admin/arrears-reminders' && init?.method === 'POST');
    expect(JSON.parse(post?.[1].body)).toEqual({ registrationIds: ['reg-1'], template: 'outstanding' });
  });
});
