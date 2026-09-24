import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin } from '../../test-utils';

// Stubbing SheetJS keeps these about the panel; parsing and joining have their own tests.
const SHEET = [
  ['FAN ID', 'First Names', 'Surname', 'Date of birth', 'Team', 'Registration Status'],
  ['FAN001', 'Ada', 'Lovelace', '04/11/2009', 'U15 Reds', 'Active'],
  ['FAN002', 'Grace', 'Hopper', '09/12/2010', 'U15 Reds', 'Cancelled'],
  ['FAN003', 'Alan', 'Turing', '23/06/2011', 'U18 Blues', 'Active'],
];

const writeFile = vi.fn();
const jsonToSheet = vi.fn(() => ({}) as Record<string, unknown>);
const bookAppendSheet = vi.fn();
const sheetToJson = vi.fn(() => SHEET);

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: {
    sheet_to_json: (...args: unknown[]) => sheetToJson(...args),
    json_to_sheet: (...args: unknown[]) => jsonToSheet(...args),
    book_new: vi.fn(() => ({})),
    book_append_sheet: (...args: unknown[]) => bookAppendSheet(...args),
  },
  writeFile: (...args: unknown[]) => writeFile(...args),
  SSF: { parse_date_code: vi.fn(() => null) },
}));

const captureEvent = vi.fn();
vi.mock('../../../lib/posthog', () => ({
  captureEvent: (...args: unknown[]) => captureEvent(...args),
  captureError: vi.fn(),
}));

import { StatusReportPanel } from '../../../pages/registrations/StatusReportPanel';

/** jsdom's FileReader fires onload a tick later, which makes "parsed yet?" racy. */
class SyncFileReader {
  onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null;

  /** Deliver a small buffer synchronously to the load callback. */
  readAsArrayBuffer() {
    this.onload?.({ target: { result: new ArrayBuffer(8) } });
  }
}

class DeferredFileReader {
  static instances: DeferredFileReader[] = [];
  onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null;

  constructor() {
    DeferredFileReader.instances.push(this);
  }

  readAsArrayBuffer() {}

  resolve() {
    this.onload?.({ target: { result: new ArrayBuffer(8) } });
  }
}

const registrations = [
  {
    fanId: 'FAN001',
    teamName: 'U15 Reds',
    registrationStatus: 'active',
    registrationExpiry: '2026-08-01',
    subscriptionLevelName: 'Full Member',
    paymentStatus: 'active',
  },
  {
    fanId: 'FAN999',
    teamName: 'U15 Reds',
    registrationStatus: 'active',
    registrationExpiry: '2026-08-01',
    subscriptionLevelName: 'Full Member',
    paymentStatus: null,
  },
];

/**
 * Render the panel and return a file-selecting helper.
 *
 * The rows arrive through a loader now rather than a prop: the table holds one
 * page, so a prop would narrow the report to whatever was on screen. The loader
 * is called after the workbook parses, which is why every assertion here waits.
 */
function renderPanel(props: Partial<React.ComponentProps<typeof StatusReportPanel>> = {}) {
  const { container } = renderWithMantine(
    <StatusReportPanel
      loadRegistrations={async () => registrations}
      faFilter={{}}
      clubSlug="test-club"
      filtersActive={false}
      {...props}
    />,
    { authValue: mockAdmin },
  );
  /**
   * Choose a file and wait for the rows.
   *
   * Awaited because loadRegistrations is a promise: the panel parses the
   * workbook first and only then asks for the registrations, so the join does
   * not exist on the synchronous tick the way it did with a rows prop.
   */
  const choose = (name = 'fa-report.xlsx') => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [file] } });
  };
  const select = async (name = 'fa-report.xlsx') => {
    choose(name);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Download status report/ })).toBeEnabled());
  };
  return { container, select, choose };
}

describe('StatusReportPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', SyncFileReader);
    writeFile.mockClear();
    jsonToSheet.mockClear();
    bookAppendSheet.mockClear();
    captureEvent.mockClear();
    sheetToJson.mockReset();
    sheetToJson.mockReturnValue(SHEET);
  });

  it('keeps the download button disabled until a file parses', async () => {
    const { select } = renderPanel();

    expect(screen.getByRole('button', { name: /Download status report/ })).toBeDisabled();

    await select();

    expect(screen.getByRole('button', { name: /Download status report/ })).toBeEnabled();
  });

  it('opens the file picker with Enter and Space and prevents Space scrolling', async () => {
    const { container } = renderPanel();
    const dropzone = screen.getByRole('button', { name: /Drop a file here or click to browse/ });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.fn();
    input.click = click;

    expect(dropzone).toHaveAttribute('tabindex', '0');
    expect(fireEvent.keyDown(dropzone, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(dropzone, { key: ' ' })).toBe(false);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale file read after a newer file has finished', async () => {
    // `choose`, not `select`: the point is that nothing becomes ready.
    DeferredFileReader.instances = [];
    vi.stubGlobal('FileReader', DeferredFileReader);
    const { choose } = renderPanel();

    choose('first.xlsx');
    choose('second.xlsx');
    act(() => {
      DeferredFileReader.instances[1].resolve();
      DeferredFileReader.instances[0].resolve();
    });

    expect(screen.getByText('second.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('Could not parse file')).not.toBeInTheDocument();
    expect(sheetToJson).toHaveBeenCalledTimes(1);
  });

  it('previews the three classifications', async () => {
    const { select } = renderPanel();
    await select();

    // FAN001 in both, FAN003 file only, FAN999 registration only, FAN002 Cancelled.
    expect(screen.getByText('1 matched')).toBeInTheDocument();
    expect(screen.getByText('1 no subs record')).toBeInTheDocument();
    expect(screen.getByText('1 subs only')).toBeInTheDocument();
  });

  it('brings Cancelled rows back when the checkbox is ticked', async () => {
    const { select } = renderPanel();
    await select();

    fireEvent.click(screen.getByLabelText(/Include FA rows marked Cancelled or Transferred/));

    expect(screen.getByText('2 no subs record')).toBeInTheDocument();
  });

  it('renders a parse error without crashing and leaves the button disabled', async () => {
    sheetToJson.mockReturnValue([['Name', 'Team'], ['Ada', 'U15 Reds']]);
    const { choose } = renderPanel();

    choose();

    expect(screen.getByText('Could not parse file')).toBeInTheDocument();
    expect(screen.getByText(/Could not find a header row containing "FAN ID"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download status report/ })).toBeDisabled();
  });

  it('warns rather than fails when the file has no date-of-birth column', async () => {
    sheetToJson.mockReturnValue([
      ['FAN ID', 'Surname', 'Team'],
      ['FAN001', 'Lovelace', 'U15 Reds'],
    ]);
    const { select } = renderPanel();

    await select();

    expect(screen.getByText('Some columns are missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download status report/ })).toBeEnabled();
  });

  it('writes one Status Report sheet to a dated, club-scoped filename', async () => {
    const { select } = renderPanel();
    await select();

    fireEvent.click(screen.getByRole('button', { name: /Download status report/ }));

    expect(bookAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Status Report');
    const today = new Date().toISOString().slice(0, 10);
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), `test-club-status-report-${today}.xlsx`);
  });

  // Guards #94: a name or FAN number here would put personal data in PostHog.
  it('reports counts only to analytics', async () => {
    const { select } = renderPanel();
    await select();

    fireEvent.click(screen.getByRole('button', { name: /Download status report/ }));

    expect(captureEvent).toHaveBeenCalledWith('status report generated', {
      club_slug: 'test-club',
      row_count: 3,
      matched: 1,
      no_subs_record: 1,
      subs_only: 1,
    });
    const [, payload] = captureEvent.mock.calls[0];
    expect(JSON.stringify(payload)).not.toMatch(/Lovelace|Turing|FAN00/);
  });

  it('says so when a subscription filter is hiding players with no subs record', async () => {
    const { select } = renderPanel({ faFilter: { dropFaOnly: true }, filtersActive: true });
    await select();

    expect(screen.getByText(/players with no subs record are left out/)).toBeInTheDocument();
    expect(screen.getByText('0 no subs record')).toBeInTheDocument();
  });
});
