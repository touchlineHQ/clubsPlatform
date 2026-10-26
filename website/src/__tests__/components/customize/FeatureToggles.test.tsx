import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { FeatureToggles } from '../../../components/customize/FeatureToggles';
import { renderWithMantine, mockSingleClub, mockAdmin } from '../../test-utils';

vi.mock('../../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

const render = (pitchBookings: boolean, onFeaturesChange = vi.fn()) => {
  renderWithMantine(<FeatureToggles pitchBookings={pitchBookings} onFeaturesChange={onFeaturesChange} />, {
    clubValue: mockSingleClub, authValue: mockAdmin,
  });
  return onFeaturesChange;
};

describe('FeatureToggles (#83)', () => {
  it('turns pitch bookings on for this club and reports the resolved features', async () => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PUT'
      ? new Response(JSON.stringify({ ok: true, features: { pitchBookings: true }, killed: { pitchBookings: false } }))
      : new Response(JSON.stringify({ features: { pitchBookings: false }, killed: { pitchBookings: false } })));
    const onChange = render(false);
    const sw = screen.getByRole('switch', { name: 'Pitch bookings' }) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    fireEvent.click(sw);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ pitchBookings: true }));
    const put = mockFetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put?.[1].body)).toEqual({ feature: 'pitchBookings', enabled: true });
  });

  it('cannot be switched on when the platform has it killed', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ features: { pitchBookings: false }, killed: { pitchBookings: true } })));
    render(false);
    expect(await screen.findByText(/Turned off for the whole platform/)).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Pitch bookings' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('stays disabled until the GET succeeds, and shows a load error if it fails', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 500 }));
    render(false);
    expect(await screen.findByText(/Could not load this club's feature settings/)).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Pitch bookings' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('applies the fetched setting over the registry copy', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ features: { pitchBookings: true }, killed: { pitchBookings: false } })));
    const onChange = render(false);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ pitchBookings: true }));
  });
});
