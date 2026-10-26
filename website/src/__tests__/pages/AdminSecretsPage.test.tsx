import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../test-utils';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ secrets: [], publicKey: null }),
  });
});

import { AdminSecretsPage } from '../../pages/AdminSecretsPage';

describe('AdminSecretsPage', () => {
  it('renders a loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(<AdminSecretsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('renders the secrets page after loading', async () => {
    const secretRow = { id: 'sec_1', key: 'STRIPE_KEY', updatedAt: 1700000000 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ secrets: [secretRow], publicKey: null }),
    });

    renderWithMantine(<AdminSecretsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('STRIPE_KEY')).toBeTruthy();
    });
  });

  it('shows an error when API fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<AdminSecretsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });

  it('clears an earlier delete error when the admin retries', async () => {
    const rows = [
      { id: 'sec_1', key: 'GC_ACCESS_TOKEN', updatedAt: 1700000000 },
      { id: 'sec_2', key: 'GC_WEBHOOK_SECRET', updatedAt: 1700000000 },
    ];
    let deletes = 0;
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deletes++;
        return deletes === 1
          ? { ok: false, status: 409, json: async () => ({ error: 'Remove the platform GC_WEBHOOK_SECRET first' }) }
          : { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ secrets: rows, publicKey: null }) };
    });

    renderWithMantine(<AdminSecretsPage />, { authValue: mockAdmin, clubValue: mockSingleClub });
    fireEvent.click(await screen.findByLabelText('Delete GC_ACCESS_TOKEN'));
    expect(await screen.findByText(/Remove the platform GC_WEBHOOK_SECRET first/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Delete GC_WEBHOOK_SECRET'));
    await waitFor(() => expect(screen.queryByText(/Remove the platform GC_WEBHOOK_SECRET first/)).toBeNull());
  });
});
