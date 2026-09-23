import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithMantine, mockAdmin } from '../../test-utils';

// The panel reads the workbook with SheetJS. Stubbing it keeps these tests
// about the preview flow rather than about spreadsheet parsing, which
// parseSheet's own shape already pins down.
// Carries the personal columns a real export has, so the payload assertion proves they drop.
const HEADER = ['FAN ID', 'First Names', 'Surname', 'Date of birth', 'Team', 'Registration Status'];
const SMALL_SHEET = [
  HEADER,
  ['FAN001', 'Ada', 'Lovelace', '04/11/2009', 'U11 Boys', 'Active'],
  ['FAN002', 'Grace', 'Hopper', '09/12/2010', 'U11 Boys', 'Active'],
];

/** Reassignable so one test can drop a file big enough to be chunked. */
let SHEET: unknown[][] = SMALL_SHEET;

/** A sheet of `n` distinct players, for exercising the chunked write path. */
function sheetOf(n: number): unknown[][] {
  return [
    HEADER,
    ...Array.from({ length: n }, (_, i) => [
      `FAN${String(i).padStart(3, '0')}`, 'Ada', 'Lovelace', '04/11/2009', 'U11 Boys', 'Active',
    ]),
  ];
}

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

  /** Deliver a small buffer synchronously to the registered load callback. */
  readAsArrayBuffer() {
    this.onload?.({ target: { result: new ArrayBuffer(8) } });
  }
}

const mockFetch = vi.fn();

/** Build a successful preview response with optional field overrides. */
const previewBody = (over: Record<string, unknown> = {}) => ({
  ok: true,
  players: { created: 1 },
  registrations: { created: 2, updated: 3 },
  users: { created: 0, skipped: 0 },
  errors: [],
  stale: { count: 0, rows: [] },
  ...over,
});

/** Build the minimal successful fetch response used by these tests. */
const jsonOk = (body: unknown) => ({ ok: true, json: async () => body });

/**
 * Render the panel and return a `select` that picks a workbook. The dropzone
 * unmounts once a file is parsed, so selecting a second one means re-querying
 * the input after "Change file" has brought it back.
 */
function renderPanel() {
  const { container } = renderWithMantine(<ImportPlayersPanel />, { authValue: mockAdmin });
  const select = (name = 'players.xlsx') => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [file] } });
  };
  return { container, select };
}

/** Render the panel and select a representative player workbook. */
function dropFile() {
  const { container, select } = renderPanel();
  select();
  return container;
}

describe('ImportPlayersPanel preview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('FileReader', SyncFileReader);
    mockFetch.mockReset();
    SHEET = SMALL_SHEET;
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

  // Guards #94: the file has names and DOB, the posted payload must not.
  it('posts no name or date-of-birth field, even though the file has them', async () => {
    mockFetch.mockResolvedValue(jsonOk(previewBody()));

    dropFile();
    await screen.findByText('2 to create');

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(Object.keys(body.rows[0])).toEqual([
      'fanId', 'ageGroup', 'teamName', 'registrationExpiry', 'registrationStatus',
      'playerEmail', 'parentEmails',
    ]);
    expect(init.body).not.toMatch(/Lovelace|Hopper|Ada|Grace|04\/11\/2009/);
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

  it('ignores a superseded preview that resolves after the current one', async () => {
    // Two previews in flight, resolving in reverse order. If the abandoned one
    // is allowed to land, the admin approves one file's stale list and commits
    // a different file's rows.
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mockFetch
      .mockReturnValueOnce(new Promise(r => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise(r => { resolveSecond = r; }));

    const { select } = renderPanel();
    select('first.xlsx');

    // Abandon it mid-flight and pick another file.
    fireEvent.click(await screen.findByRole('button', { name: /Change file/ }));
    select('second.xlsx');

    await act(async () => {
      resolveSecond(jsonOk(previewBody({ registrations: { created: 7, updated: 8 } })));
    });
    expect(await screen.findByText('7 to create')).toBeInTheDocument();

    // The abandoned request now answers. It must change nothing.
    await act(async () => {
      resolveFirst(jsonOk(previewBody({ registrations: { created: 1, updated: 1 } })));
    });

    expect(screen.getByText('7 to create')).toBeInTheDocument();
    expect(screen.getByText('8 to update')).toBeInTheDocument();
    expect(screen.queryByText('1 to create')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 2 players/ })).not.toBeDisabled();
  });
});

describe('ImportPlayersPanel chunked commit', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('FileReader', SyncFileReader);
    mockFetch.mockReset();
    SHEET = SMALL_SHEET;
  });

  /** Preview once, then commit, with `n` players in the file. */
  async function commitFileOf(n: number, chunkResponse = previewBody()) {
    SHEET = sheetOf(n);
    mockFetch.mockResolvedValueOnce(jsonOk(previewBody({ stale: { count: 1, rows: [] } })));

    dropFile();

    const button = await screen.findByRole('button', { name: new RegExp(`Import ${n} players`) });
    await waitFor(() => expect(button).not.toBeDisabled());

    mockFetch.mockResolvedValue(jsonOk({ ...chunkResponse, runId: 'imprun_test' }));
    fireEvent.click(button);
    return button;
  }

  it('sends a big file in slices, so one request cannot exhaust the CPU budget', async () => {
    // 60 players at 25 a slice: preview, then three writes.
    await commitFileOf(60);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));

    const writes = mockFetch.mock.calls.slice(1).map(c => JSON.parse(c[1].body));
    expect(writes.map(w => w.rows.length)).toEqual([25, 25, 10]);
    expect(writes.map(w => w.part)).toEqual([
      { index: 0, total: 3 },
      { index: 1, total: 3, runId: 'imprun_test' },
      { index: 2, total: 3, runId: 'imprun_test' },
    ]);
  });

  it('sends one unchunked request for a small file', async () => {
    // The part is still sent, so the server takes the same path either way.
    await commitFileOf(2);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const write = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(write.rows).toHaveLength(2);
    expect(write.part).toEqual({ index: 0, total: 1 });
  });

  it('sums the counts across slices rather than showing only the last', async () => {
    await commitFileOf(60, previewBody({
      players: { created: 1 },
      registrations: { created: 2, updated: 3 },
      users: { created: 1, skipped: 1 },
      errors: [],
    }));

    // Three slices of the same stubbed response: 1/2/3/1/1 each, tripled.
    const summary = await screen.findByText(/New players:/);
    expect(summary).toHaveTextContent('New players: 3');
    expect(screen.getByText(/^Registrations:/)).toHaveTextContent('6 created, 9 updated');
    expect(screen.getByText(/^User accounts:/)).toHaveTextContent('3 created, 3 already existed');
  });

  it('keeps the stale list from the whole-file preview, not from a slice', async () => {
    // A slice covers only its own teams, so the server sends back no stale rows
    // for one; taking the slice's answer would report "0 no longer in file" and
    // quietly lose the warning.
    await commitFileOf(60, previewBody({ stale: { count: 0, rows: [] } }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/No longer in the file:/)).toHaveTextContent('1');
  });

  it('says how much landed when a slice fails part-way through', async () => {
    SHEET = sheetOf(60);
    mockFetch.mockResolvedValueOnce(jsonOk(previewBody()));
    dropFile();

    const button = await screen.findByRole('button', { name: /Import 60 players/ });
    await waitFor(() => expect(button).not.toBeDisabled());

    mockFetch
      .mockResolvedValueOnce(jsonOk({
        ...previewBody({ registrations: { created: 25, updated: 0 } }),
        runId: 'imprun_test',
      }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Boom' }) });
    fireEvent.click(button);

    // Silence about the first slice would have the admin re-import blind.
    expect(await screen.findByText(/25 registrations were imported before this failed/i))
      .toBeInTheDocument();
  });
});
