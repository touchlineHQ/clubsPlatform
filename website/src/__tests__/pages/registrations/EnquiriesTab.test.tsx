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

  it('ignores a second delete click while the first is in flight', async () => {
    let finishDelete!: (value: Response) => void;
    const deletePromise = new Promise<Response>((resolve) => { finishDelete = resolve; });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return deletePromise;
      return new Response(JSON.stringify({ items: [row], hasMore: false }));
    });
    renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
    const btn = await screen.findByLabelText('Delete enquiry');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE')).toHaveLength(1);
    finishDelete(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(screen.queryByLabelText('Delete enquiry')).toBeNull());
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE')).toHaveLength(1);
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
    // PATCH fails, then the resync fails — rows must stay, empty-state must not appear.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 500 }))
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

  describe('with two pages loaded', () => {
    const row2 = { ...row, id: 'enq_2', contactEmail: 'other@example.com', contactName: 'Other' };
    const page = (items: unknown[], hasMore: boolean) => new Response(JSON.stringify({ items, hasMore }));
    const loadTwoPages = async () => {
      fetchMock.mockResolvedValueOnce(page([row], true)).mockResolvedValueOnce(page([row2], false));
      renderWithMantine(<EnquiriesTab clubSlug="test-club" />);
      expect(await screen.findByText(/pat@example.com/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Load more/i }));
      expect(await screen.findByText(/other@example.com/)).toBeTruthy();
      fetchMock.mockClear();
    };

    it('updates status in place and clears contacts on a terminal status, keeping page 2', async () => {
      await loadTwoPages();
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
      fireEvent.change(screen.getByLabelText('Status for enquiry enq_1'), { target: { value: 'registered' } });
      expect(await screen.findByText('Contact details deleted')).toBeTruthy();
      expect(screen.queryByText(/pat@example.com/)).toBeNull();
      expect(screen.getByText(/other@example.com/)).toBeTruthy();
      expect((screen.getByLabelText('Status for enquiry enq_1') as HTMLSelectElement).value).toBe('registered');
      expect(fetchMock).toHaveBeenCalledTimes(1); // PATCH only, no page-1 reload
    });

    it('removes a deleted row in place, keeping page 2', async () => {
      await loadTwoPages();
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
      fireEvent.click(screen.getAllByLabelText('Delete enquiry')[0]);
      await waitFor(() => expect(screen.queryByText(/pat@example.com/)).toBeNull());
      expect(screen.getByText(/other@example.com/)).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1); // DELETE only
    });

    it('on a failed change resyncs every loaded page', async () => {
      await loadTwoPages();
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'closed' }), { status: 409 }))
        .mockResolvedValueOnce(page([row], true))
        .mockResolvedValueOnce(page([row2], false));
      fireEvent.change(screen.getByLabelText('Status for enquiry enq_2'), { target: { value: 'contacted' } });
      expect(await screen.findByText('That change did not save.')).toBeTruthy();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/enquiries?offset=0');
      expect(fetchMock.mock.calls[2][0]).toBe('/api/admin/enquiries?offset=1');
      expect(screen.getByText(/pat@example.com/)).toBeTruthy();
      expect(screen.getByText(/other@example.com/)).toBeTruthy();
    });
  });
});
