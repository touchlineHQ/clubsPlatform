import { useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconFileSpreadsheet } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import { clubDesign } from '../../theme';
import { FileDropzone } from '../../components/club/FileDropzone';
import { captureEvent } from '../../lib/posthog';
import { buildPaymentLink } from '../../utils/paymentLink';
import { parseReportSheet, readWorkbookRows, type FaReportPlayerRow } from '../../utils/faPlayerReport';
import {
  buildStatusReport,
  summariseStatusReport,
  toSheetRows,
  STATUS_REPORT_COLUMNS,
  type FaRowFilter,
  type StatusReportRegistration,
} from '../../utils/statusReport';

interface StatusReportPanelProps {
  /**
   * Loads every registration matching the page's filters.
   *
   * A loader rather than an array: the table only holds one page now, so a prop
   * would narrow the report to whatever happened to be on screen. Called after
   * the workbook parses rather than when the modal opens, so an admin who opens
   * the dialog and changes their mind costs nothing.
   */
  loadRegistrations: () => Promise<StatusReportRegistration[]>;
  /** The same filters, as they apply to FA rows with no registration. */
  faFilter: FaRowFilter;
  clubSlug: string;
  /** Whether any page filter is on, so the panel can say the report honours it. */
  filtersActive: boolean;
}

/**
 * Join an FA Club Player Report against the club's registrations and download it.
 * Parsed, joined and written in the browser; no name or DOB leaves the page (#94).
 */
export function StatusReportPanel({
  loadRegistrations,
  faFilter,
  clubSlug,
  filtersActive,
}: StatusReportPanelProps) {
  const [registrations, setRegistrations] = useState<StatusReportRegistration[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [fileName, setFileName] = useState('');
  const [faRows, setFaRows] = useState<FaReportPlayerRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const readSequence = useRef(0);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const rows = useMemo(
    () => (faRows === null || registrations === null ? [] : buildStatusReport(faRows, registrations, {
      includeCancelled,
      faFilter,
      paymentLink: fanId => buildPaymentLink(origin, clubSlug, fanId),
    })),
    [faRows, registrations, includeCancelled, faFilter, origin, clubSlug],
  );

  const summary = useMemo(() => summariseStatusReport(rows), [rows]);

  /** Parse a chosen workbook; nothing leaves the browser. */
  function handleFile(file: File) {
    const readToken = ++readSequence.current;
    setFaRows(null);
    // Cleared here, not only on success: a second file left the previous load in
    // place, so the counts and the download read as ready against rows that had
    // not been refreshed — and stayed ready if the new load then failed.
    setRegistrations(null);
    setLoadError('');
    setParseErrors([]);
    setWarnings([]);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      if (readToken !== readSequence.current) return;
      try {
        const { parsed, errors, warnings: found } = parseReportSheet(readWorkbookRows(e.target?.result));
        if (errors.length) {
          setParseErrors(errors);
        } else {
          setFaRows(parsed);
          setWarnings(found);
          // Only now: a file that does not parse needs no registrations, and
          // fetching them is a walk over every page of the filtered set.
          loadRegistrations()
            .then((rows) => { if (readToken === readSequence.current) setRegistrations(rows); })
            .catch((err) => {
              if (readToken !== readSequence.current) return;
              setLoadError(err instanceof Error ? err.message : 'Failed to load registrations');
            });
        }
      } catch (err) {
        setParseErrors([`Failed to read file: ${String(err)}`]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /** Write the joined rows to a workbook and hand it to the browser. */
  function handleDownload() {
    const ws = XLSX.utils.json_to_sheet(toSheetRows(rows));
    ws['!cols'] = STATUS_REPORT_COLUMNS.map(c => ({ wch: c.wch }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Status Report');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${clubSlug || 'club'}-status-report-${today}.xlsx`);

    // Counts only. No names, no dates of birth, no FAN numbers.
    captureEvent('status report generated', {
      club_slug: clubSlug,
      row_count: summary.rowCount,
      matched: summary.matched,
      no_subs_record: summary.noSubsRecord,
      subs_only: summary.subsOnly,
    });
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Pick your FA <strong>Club - Player Report</strong>. Player names are read in your
        browser, joined to this club's registrations and written straight to a spreadsheet.
        Nothing is uploaded and no personal data is stored.
      </Text>

      {!faRows && <FileDropzone onFile={handleFile} />}

      {loadError && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {loadError}
        </Alert>
      )}

      {parseErrors.length > 0 && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md" title="Could not parse file">
          {parseErrors.map((e, i) => <Text key={i} size="sm">{e}</Text>)}
          <Button
            mt="sm"
            size="xs"
            radius="xl"
            variant="outline"
            onClick={() => { setParseErrors([]); setFileName(''); }}
          >
            Try another file
          </Button>
        </Alert>
      )}

      {faRows && (
        <Stack gap="md">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Title order={5} ff={clubDesign.font.heading} fw={800}>{fileName}</Title>
              <Text size="sm" c="dimmed">{faRows.length} players in the file</Text>
            </div>
            <Button
              size="xs"
              radius="xl"
              variant="subtle"
              onClick={() => { setFaRows(null); setWarnings([]); setFileName(''); setLoadError(''); }}
            >
              Change file
            </Button>
          </Group>

          {warnings.length > 0 && (
            <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md" title="Some columns are missing">
              {warnings.map((w, i) => <Text key={i} size="sm">{w}</Text>)}
            </Alert>
          )}

          {registrations === null && !loadError ? (
            // Every count is zero until the rows land, and the walk over the
            // filtered set is many requests on a large club. "0 matched" reads
            // as a failed join, so say what is happening instead of showing it.
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">Loading this club&rsquo;s registrations…</Text>
            </Group>
          ) : (
            <Group gap="xs" wrap="wrap">
              <Badge color="teal" variant="light" size="lg">{summary.matched} matched</Badge>
              <Badge color="orange" variant="light" size="lg">{summary.noSubsRecord} no subs record</Badge>
              <Badge color="grape" variant="light" size="lg">{summary.subsOnly} subs only</Badge>
            </Group>
          )}

          <Checkbox
            checked={includeCancelled}
            onChange={e => setIncludeCancelled(e.currentTarget.checked)}
            label="Include FA rows marked Cancelled or Transferred"
          />

          {filtersActive && (
            <Text size="xs" c="dimmed">
              The report honours the filters on the table, as Export to Excel does.
              {faFilter.dropFaOnly && ' A subscription filter is active, so players with no subs record are left out — they have no subscription to filter on.'}
            </Text>
          )}
        </Stack>
      )}

      <Group justify="flex-end">
        <Button
          leftSection={<IconFileSpreadsheet size={16} />}
          onClick={handleDownload}
          radius="xl"
          disabled={faRows === null || registrations === null}
        >
          Download status report
        </Button>
      </Group>
    </Stack>
  );
}
