import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../lib/posthog', () => ({ captureEvent: vi.fn(), captureError: vi.fn() }));
import { EnquiryForm } from '../../components/club/EnquiryForm';
import { renderWithMantine } from '../test-utils';

const config = {
  enabled: true,
  turnstileSiteKey: 'site',
  ageGroups: [
    { ageGroup: 'U12', under16: true, teams: ['U12 Reds'] },
    { ageGroup: 'Open Age', under16: false, teams: ['First Team'] },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(JSON.stringify(init?.method === 'POST' ? { ok: true } : config), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  window.turnstile = { render: vi.fn((_el, opts) => { opts.callback('tok'); return 'w1'; }), reset: vi.fn() };
});
afterEach(() => { vi.unstubAllGlobals(); delete window.turnstile; });

async function chooseAgeGroup(name: string) {
  fireEvent.click(await screen.findByRole('combobox', { name: /age group/i }));
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('EnquiryForm (#73)', () => {
  it('renders nothing when the form is not enabled', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...config, enabled: false })));
    const { container } = renderWithMantine(<EnquiryForm />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('form')).toBeNull();
  });

  it.each([null, '', '  '])('renders no form or Turnstile widget when the site key is %j', async (key) => {
    let configRead = false;
    const payload = { ...config, enabled: true, turnstileSiteKey: key };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => { configRead = true; return payload; },
    } as Response);
    const { container } = renderWithMantine(<EnquiryForm />);
    // Wait until the component has consumed the config response, not merely
    // until fetch was invoked (which can race ahead of setConfig).
    await waitFor(() => expect(configRead).toBe(true));
    await waitFor(() => {
      expect(container.querySelector('form')).toBeNull();
      expect(document.querySelector('script[src*="turnstile"]')).toBeNull();
    });
  });

  it('never renders a player email field for under 16s', async () => {
    renderWithMantine(<EnquiryForm />);
    await chooseAgeGroup('U12');
    expect(screen.queryByText(/I am/)).toBeNull();
    expect(screen.queryByLabelText(/^Your email/)).toBeNull();
    expect(screen.getByLabelText(/Parent or guardian email/)).toBeTruthy();
  });

  it('lets an adult player enquire for themselves', async () => {
    renderWithMantine(<EnquiryForm />);
    await chooseAgeGroup('Open Age');
    fireEvent.click(screen.getByLabelText('The player'));
    expect(screen.getByLabelText(/^Your email/)).toBeTruthy();
    expect(screen.queryByLabelText(/Player first name/)).toBeNull();
  });

  it('submits with the Turnstile token and an empty honeypot', async () => {
    renderWithMantine(<EnquiryForm />);
    await chooseAgeGroup('U12');
    fireEvent.change(screen.getByLabelText(/Parent or guardian name/), { target: { value: 'Pat' } });
    fireEvent.change(screen.getByLabelText(/Parent or guardian email/), { target: { value: 'pat@example.com' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByText(/your enquiry has been sent/)).toBeTruthy();
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toMatchObject({
      ageGroup: 'U12', enquirerType: 'guardian', contactEmail: 'pat@example.com', consent: true, website: '', turnstileToken: 'tok',
    });
  });

  it('shows the server error', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'Too many enquiries.' }), { status: 429 })
      : new Response(JSON.stringify(config)));
    renderWithMantine(<EnquiryForm />);
    await chooseAgeGroup('U12');
    fireEvent.change(screen.getByLabelText(/Parent or guardian name/), { target: { value: 'Pat' } });
    fireEvent.change(screen.getByLabelText(/Parent or guardian email/), { target: { value: 'pat@example.com' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByText('Too many enquiries.')).toBeTruthy();
  });
});
