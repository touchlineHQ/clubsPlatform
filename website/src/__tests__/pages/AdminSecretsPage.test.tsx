import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
});
