import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/posthog', () => ({ captureEvent: vi.fn(), captureError: vi.fn() }));
import { EnquiriesTab } from '../../../pages/registrations/EnquiriesTab';
import { renderWithMantine } from '../../test-utils';

const row = { id: 'enq_1', ageGroup: 'U12', team: 'U12 Reds', enquirerType: 'guardian', contactName: 'Pat', contactEmail: 'pat@example.com',
  contactPhone: null, playerFirstName: 'Sam', status: 'new', contactPurgedAt: null, createdAt: 0 };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [row] })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('EnquiriesTab (#73)', () => {
  it('lists enquiries and changes status', async () => {
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/pat@example.com/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status for enquiry enq_1'), { target: { value: 'registered' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!;
    expect(JSON.parse(patch[1].body)).toEqual({ id: 'enq_1', status: 'registered' });
  });

  it('deletes an enquiry', async () => {
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    fireEvent.click(await screen.findByLabelText('Delete enquiry'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/enquiries?id=enq_1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('shows purged contacts as deleted', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ ...row, contactEmail: null, contactName: null }] })));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText('Contact details deleted')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/No enquiries yet/)).toBeTruthy();
  });
});
