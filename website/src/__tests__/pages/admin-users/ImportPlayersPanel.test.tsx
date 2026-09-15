import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin } from '../../test-utils';

// The panel reads the workbook with SheetJS. Stubbing it keeps these tests
// about the preview flow rather than about spreadsheet parsing, which
// parseSheet's own shape already pins down.
const SHEET = [
  ['FAN ID', 'Team', 'Registration Status'],
  ['FAN001', 'U11 Boys', 'Active'],
  ['FAN002', 'U11 Boys', 'Active'],
];

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_json: vi.fn(() => SHEET) },
  SSF: { parse_date_code: vi.fn(() => null) },
}));

import { ImportPlayersPanel } from '../../../pages/admin-users/ImportPlayersPanel';

/**
 * jsdom's FileReader delivers onload on a later tick, which makes "has the
 * preview been requested yet?" racy. A synchronous stand-in keeps the assertions
 * about the component rather than about timer ordering.
 */
class SyncFileReader {
  onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null;
  readAsArrayBuffer() {
    this.onload?.({ target: { result: new ArrayBuffer(8) } });
  }
}

const mockFetch = vi.fn();

const previewBody = (over: Record<string, unknown> = {}) => ({
  ok: true,
  players: { created: 1 },
  registrations: { created: 2, updated: 3 },
  users: { created: 0, skipped: 0 },
  errors: [],
  stale: { count: 0, rows: [] },
  ...over,
});

const jsonOk = (body: unknown) => ({ ok: true, json: async () => body });

function dropFile() {
  const { container } = renderWithMantine(<ImportPlayersPanel />, { authValue: mockAdmin });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'players.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
  return container;
}

describe('ImportPlayersPanel preview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('FileReader', SyncFileReader);
    mockFetch.mockReset();
  });

  it('previews the file on parse, before anything is committed', async () => {
    mockFetch.mockResolvedValue(jsonOk(previewBody()));

    dropFile();

    expect(await screen.findByText('2 to create')).toBeInTheDocument();
    expect(screen.getByText('3 to update')).toBeInTheDocument();
    expect(screen.getByText('0 no longer in file')).toBeInTheDocument();

    // One call, and it asked the server not to write anything.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/import-players');
    expect(JSON.parse(init.body).dryRun).toBe(true);
  });

  it('lists the registrations the file leaves behind', async () => {
    mockFetch.mockResolvedValue(jsonOk(previewBody({
      stale: {
        count: 1,
        rows: [{ fanId: 'FAN999', teamName: 'U11 Boys', registrationStatus: 'Cancelled' }],
      },
    })));

    dropFile();

    expect(await screen.findByText('1 no longer in file')).toBeInTheDocument();
    expect(screen.getByText('FAN999')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('keeps the commit button unreachable until the preview resolves', async () => {
    // A preview that never settles — the button must stay disabled.
    mockFetch.mockReturnValue(new Promise(() => {}));

    dropFile();

    const button = await screen.findByRole('button', { name: /Import 2 players/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    // Still only the preview call; no commit slipped through.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed preview and does not commit', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database unavailable' }),
    });

    dropFile();

    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Import 2 players/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it('commits with dryRun off once the preview has resolved', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(previewBody()));

    dropFile();

    const button = await screen.findByRole('button', { name: /Import 2 players/ });
    await waitFor(() => expect(button).not.toBeDisabled());

    mockFetch.mockResolvedValueOnce(jsonOk(previewBody({
      registrations: { created: 2, updated: 0 },
    })));
    fireEvent.click(button);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).dryRun).toBeUndefined();
  });
});
