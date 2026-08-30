import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { PublishToggle } from '../../../components/customize/PublishToggle';
import { renderWithMantine, mockSingleClub } from '../../test-utils';
import { captureError, captureEvent } from '../../../lib/posthog';

vi.mock('../../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.mocked(captureError).mockClear();
  vi.mocked(captureEvent).mockClear();
});

const render = (published: boolean, onPublishedChange = vi.fn()) => {
  renderWithMantine(
    <PublishToggle published={published} onPublishedChange={onPublishedChange} />,
    { clubValue: mockSingleClub },
  );
  return onPublishedChange;
};

describe('PublishToggle', () => {
  it('shows a private club as private, with a way to go live', () => {
    render(false);
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Go live/i })).toBeTruthy();
  });

  it('shows a live club as live, with a way to make it private', () => {
    render(true);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Make private/i })).toBeTruthy();
  });

  it('reassures the admin that payments keep working while private', () => {
    render(false);
    expect(screen.getByText(/Registration and payment links keep working/i)).toBeTruthy();
  });

  it('asks for confirmation before going live', () => {
    render(false);
    fireEvent.click(screen.getByRole('button', { name: /^Go live$/i }));
    expect(screen.getByText(/Make your pages visible to everyone\?/i)).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publishes the club once confirmed', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onPublishedChange = render(false);

    fireEvent.click(screen.getByRole('button', { name: /^Go live$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, go live/i }));

    await waitFor(() => expect(onPublishedChange).toHaveBeenCalledWith(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/clubs', expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'X-Club-Slug': 'test-club' }),
      body: JSON.stringify({ published: true }),
    }));
    expect(captureEvent).toHaveBeenCalledWith('club published', { club_slug: 'test-club' });
  });

  it('makes the club private once confirmed', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const onPublishedChange = render(true);

    fireEvent.click(screen.getByRole('button', { name: /^Make private$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, make private/i }));

    await waitFor(() => expect(onPublishedChange).toHaveBeenCalledWith(false));
    expect(mockFetch).toHaveBeenCalledWith('/api/clubs', expect.objectContaining({
      body: JSON.stringify({ published: false }),
    }));
    expect(captureEvent).toHaveBeenCalledWith('club unpublished', { club_slug: 'test-club' });
  });

  it('cancelling leaves the club as it was', () => {
    const onPublishedChange = render(false);
    fireEvent.click(screen.getByRole('button', { name: /^Go live$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onPublishedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Go live$/i })).toBeTruthy();
  });

  it('surfaces the error and keeps the old state when the update fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Access denied: club mismatch' }) });
    const onPublishedChange = render(false);

    fireEvent.click(screen.getByRole('button', { name: /^Go live$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, go live/i }));

    await waitFor(() => expect(screen.getByText('Access denied: club mismatch')).toBeTruthy());
    expect(onPublishedChange).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();
  });
});
