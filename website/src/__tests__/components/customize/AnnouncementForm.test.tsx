import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnouncementForm } from '../../../components/customize/AnnouncementForm';
import { renderWithMantine, mockSingleClub, mockAdmin } from '../../test-utils';

vi.mock('../../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('AnnouncementForm (#74)', () => {
  it('publishes, hands the item back, and shows a WhatsApp copy block', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/registration-facets')) {
        return new Response(JSON.stringify({ teams: ['U12 Blues'] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        item: { id: 'news_1', title: 'Training cancelled', text: 'Pitch waterlogged.', link: '#', linkText: 'Read More' },
        copyText: '*Test FC: Training cancelled*\n\nPitch waterlogged.',
        email: null,
      }), { status: 201 });
    });
    const onPublished = vi.fn();
    renderWithMantine(<AnnouncementForm onPublished={onPublished} />, { clubValue: mockSingleClub, authValue: mockAdmin });

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Training cancelled' } });
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Pitch waterlogged.' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }));

    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ id: 'news_1' })));
    const post = mockFetch.mock.calls.find(([u]) => u === '/api/admin/announcements');
    expect(JSON.parse(post?.[1].body)).toEqual({ title: 'Training cancelled', text: 'Pitch waterlogged.' });
    expect((screen.getByTestId('whatsapp-copy') as HTMLTextAreaElement).value).toContain('*Test FC: Training cancelled*');
    expect(screen.getByRole('button', { name: /Copy for WhatsApp/ })).toBeTruthy();
  });
});
