import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/posthog', () => ({ captureEvent: vi.fn(), captureError: vi.fn() }));
import { EnquiriesTab } from '../../../pages/registrations/EnquiriesTab';
import { renderWithMantine } from '../../test-utils';

const row = { id: 'enq_1', ageGroup: 'U12', team: 'U12 Reds', enquirerType: 'guardian', contactName: 'Pat', contactEmail: 'pat@example.com',
  contactPhone: null, playerFirstName: 'Sam', status: 'new', contactPurgedAt: null, createdAt: 0 };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [row], hasMore: false })));
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ ...row, contactEmail: null, contactName: null }], hasMore: false })));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText('Contact details deleted')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [], hasMore: false })));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/No enquiries yet/)).toBeTruthy();
  });

  it('on initial load failure shows the error and not the empty-state', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText('Could not load enquiries.')).toBeTruthy();
    expect(screen.queryByText(/No enquiries yet/)).toBeNull();
  });

  it('preserves previous rows when a later load fails', async () => {
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/pat@example.com/)).toBeTruthy();
    // PATCH ok, then reload fails — rows must stay, empty-state must not appear.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockRejectedValueOnce(new Error('network down'));
    fireEvent.change(screen.getByLabelText('Status for enquiry enq_1'), { target: { value: 'contacted' } });
    expect(await screen.findByText('Could not load enquiries.')).toBeTruthy();
    expect(screen.getByText(/pat@example.com/)).toBeTruthy();
    expect(screen.queryByText(/No enquiries yet/)).toBeNull();
  });

  it('shows the same error alert when mutate fetch rejects, then reloads', async () => {
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/pat@example.com/)).toBeTruthy();
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [row], hasMore: false })));
    fireEvent.change(screen.getByLabelText('Status for enquiry enq_1'), { target: { value: 'contacted' } });
    expect(await screen.findByText('That change did not save.')).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)); // initial + PATCH + reload
  });

  it('shows Load more when hasMore and appends the next page', async () => {
    const row2 = { ...row, id: 'enq_2', contactEmail: 'other@example.com', contactName: 'Other' };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [row], hasMore: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [row2], hasMore: false })));
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    expect(await screen.findByText(/pat@example.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Load more/i }));
    expect(await screen.findByText(/other@example.com/)).toBeTruthy();
    expect(screen.getByText(/pat@example.com/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load more/i })).toBeNull();
  });
});
