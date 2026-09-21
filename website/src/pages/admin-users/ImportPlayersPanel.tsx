import { useRef, useState } from 'react';
import {
  Alert, Badge, Box, Button, Group, Loader,
  Paper, ScrollArea, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconUsers } from '@tabler/icons-react';
import { useClub } from '../../context/ClubContext';
import { clubDesign } from '../../theme';
import { FileDropzone } from '../../components/club/FileDropzone';
import { parseImportSheet, readWorkbookRows, type ParsedPlayerRow } from '../../utils/faPlayerReport';

/** A registration the club holds that the uploaded file no longer mentions. */
interface StaleRegistration {
  fanId: string;
  teamName: string;
  registrationStatus: string | null;
}

// Mirrors the server's ImportResult in functions/api/admin/import-players.ts.
// There is no shared module between functions/ and website/, so the two are
// kept in step by hand.
interface ImportResult {
  ok: boolean;
  players: { created: number };
  registrations: { created: number; updated: number };
  users: { created: number; skipped: number };
  errors: { fanId: string; reason: string }[];
  stale: { count: number; rows: StaleRegistration[] };
}

function summarise(rows: ParsedPlayerRow[]) {
  const uniqueFans = new Set(rows.map(r => r.fanId));
  const uniqueTeams = new Set(rows.map(r => r.teamName).filter(Boolean));
  const selfEmails = new Set(rows.map(r => r.playerEmail).filter(Boolean));
  const parentEmails = new Set(rows.flatMap(r => r.parentEmails));
  const allEmails = new Set([...selfEmails, ...parentEmails]);
  const guardianOnlyEmails = new Set([...parentEmails].filter(e => !selfEmails.has(e)));
  return { uniqueFans: uniqueFans.size, uniqueTeams: uniqueTeams.size, allEmails: allEmails.size, guardianOnlyEmails: guardianOnlyEmails.size };
}

/**
 * Registrations the club holds for a team in the file, for players the file
 * does not list. Nothing here is deleted — an admin decides what to do.
 */
function StaleTable({ rows }: { rows: StaleRegistration[] }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Title order={6} ff={clubDesign.font.heading} fw={800} mb={4}>
        No longer in the file
      </Title>
      <Text size="xs" c="dimmed" mb="xs">
        These registrations are not in the file but stay in the club’s records. Nothing is
        removed automatically.
      </Text>
      <Table fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>FAN ID</Table.Th>
            <Table.Th>Team</Table.Th>
            <Table.Th>Current status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (
            <Table.Tr key={i}>
              <Table.Td>{r.fanId}</Table.Td>
              <Table.Td>{r.teamName}</Table.Td>
              <Table.Td>{r.registrationStatus || <Text c="dimmed" size="xs">—</Text>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

interface ImportPlayersPanelProps {
  onImported?: () => void;
}

/** Parse, preview, and commit an FA player report selected by an administrator. */
export function ImportPlayersPanel({ onImported }: ImportPlayersPanelProps) {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug };

  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedPlayerRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [apiError, setApiError] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  /**
   * Which preview request the panel is currently showing.
   *
   * Picking a second file while the first is still in flight would otherwise let
   * the first response land against the second file's rows: the counts and the
   * stale list on screen would describe a file the admin is no longer importing,
   * and the commit button would enable on that basis. Every response checks it
   * still owns this counter before touching state.
   */
  const previewRequestVersion = useRef(0);

  /** Ask the server what this file would do, without letting it do any of it. */
  async function runPreview(parsed: ParsedPlayerRow[]) {
    const requestVersion = ++previewRequestVersion.current;
    const isCurrent = () => requestVersion === previewRequestVersion.current;

    setPreviewing(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await fetch('/api/admin/import-players', {
        method: 'POST',
        headers: { ...clubHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed, dryRun: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as ImportResult;
      if (isCurrent()) setPreview(data);
    } catch (err) {
      if (isCurrent()) setPreviewError(String(err));
    } finally {
      // A superseded request must not clear the flag: the request that replaced
      // it is still running, and the commit button reads this.
      if (isCurrent()) setPreviewing(false);
    }
  }

  /** Reset all state derived from the server-side import preview. */
  function clearPreview() {
    // Abandons any in-flight preview, so a late response cannot revive it.
    previewRequestVersion.current += 1;
    setPreview(null);
    setPreviewError('');
    setPreviewing(false);
  }

  /** Parse a selected workbook and request a dry-run preview for its rows. */
  function handleFile(file: File) {
    setResult(null);
    setApiError('');
    setParseErrors([]);
    setRows(null);
    clearPreview();
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { parsed, errors } = parseImportSheet(readWorkbookRows(e.target?.result));
        if (errors.length) {
          setParseErrors(errors);
        } else {
          setRows(parsed);
          void runPreview(parsed);
        }
      } catch (err) {
        setParseErrors([`Failed to read file: ${String(err)}`]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /** Commit the previously previewed import and display its result. */
  async function handleConfirm() {
    if (!rows || !preview) return;
    setImporting(true);
    setApiError('');
    try {
      const res = await fetch('/api/admin/import-players', {
        method: 'POST',
        headers: { ...clubHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as ImportResult;
      setResult(data);
      setRows(null);
      clearPreview();
      onImported?.();
    } catch (err) {
      setApiError(String(err));
    } finally {
      setImporting(false);
    }
  }

  const summary = rows ? summarise(rows) : null;

  return (
    <Stack gap="md">
      {!rows && !result && <FileDropzone onFile={handleFile} />}

      {parseErrors.length > 0 && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md" title="Could not parse file">
          {parseErrors.map((e, i) => <Text key={i} size="sm">{e}</Text>)}
          <Button mt="sm" size="xs" radius="xl" variant="outline" onClick={() => { setParseErrors([]); setFileName(''); }}>
            Try another file
          </Button>
        </Alert>
      )}

      {rows && summary && (
        <Stack gap="md">
          <Group justify="space-between" wrap="wrap">
            <Box>
              <Title order={5} ff={clubDesign.font.heading} fw={800}>{fileName}</Title>
              <Text size="sm" c="dimmed">Preview — review before importing</Text>
            </Box>
            <Button variant="subtle" size="xs" radius="xl" onClick={() => { setRows(null); setFileName(''); clearPreview(); }}>
              Change file
            </Button>
          </Group>

          <Group gap="xs">
            <Badge color="blue" radius="xl" variant="light">{summary.uniqueFans} players</Badge>
            <Badge color="teal" radius="xl" variant="light">{summary.allEmails} email accounts</Badge>
            <Badge color="grape" radius="xl" variant="light">{summary.guardianOnlyEmails} guardians</Badge>
            <Badge color="orange" radius="xl" variant="light">{summary.uniqueTeams} teams</Badge>
          </Group>

          <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <ScrollArea>
              <Table striped highlightOnHover fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>FAN ID</Table.Th>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Expiry</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Player email</Table.Th>
                    <Table.Th>Parent email(s)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{r.fanId}</Table.Td>
                      <Table.Td>{r.teamName}</Table.Td>
                      <Table.Td>{r.registrationExpiry}</Table.Td>
                      <Table.Td>{r.registrationStatus}</Table.Td>
                      <Table.Td>{r.playerEmail || <Text c="dimmed" size="xs">—</Text>}</Table.Td>
                      <Table.Td>{r.parentEmails.join(', ') || <Text c="dimmed" size="xs">—</Text>}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          {previewing && (
            <Group gap="xs">
              <Loader size={14} />
              <Text size="sm" c="dimmed">Checking this file against the club’s records…</Text>
            </Group>
          )}

          {previewError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md" title="Could not preview this import">
              <Text size="sm">{previewError}</Text>
              <Button mt="sm" size="xs" radius="xl" variant="outline" onClick={() => void runPreview(rows)}>
                Try again
              </Button>
            </Alert>
          )}

          {preview && (
            <Stack gap="md">
              <Group gap="xs">
                <Badge color="green" radius="xl" variant="light">
                  {preview.registrations.created} to create
                </Badge>
                <Badge color="blue" radius="xl" variant="light">
                  {preview.registrations.updated} to update
                </Badge>
                <Badge
                  color={preview.stale.count ? 'orange' : 'gray'}
                  radius="xl"
                  variant="light"
                >
                  {preview.stale.count} no longer in file
                </Badge>
              </Group>

              {preview.stale.count > 0 && <StaleTable rows={preview.stale.rows} />}
            </Stack>
          )}

          <Box>
            <Button
              radius="xl"
              size="md"
              leftSection={importing ? <Loader size={14} color="white" /> : <IconUsers size={16} />}
              onClick={handleConfirm}
              loading={importing}
              disabled={importing || previewing || !preview}
            >
              Import {rows.length} player{rows.length !== 1 ? 's' : ''}
            </Button>
          </Box>
        </Stack>
      )}

      {apiError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md" title="Import failed">
          {apiError}
        </Alert>
      )}

      {result && (
        <Stack gap="md">
          <Alert
            icon={<IconCheck size={16} />}
            color={result.errors.length ? 'yellow' : 'green'}
            radius="md"
            title={result.errors.length ? 'Import completed with warnings' : 'Import successful'}
          >
            <Stack gap={4}>
              <Text size="sm">New players: <b>{result.players.created}</b></Text>
              <Text size="sm">Registrations: <b>{result.registrations.created}</b> created, <b>{result.registrations.updated}</b> updated</Text>
              <Text size="sm">User accounts: <b>{result.users.created}</b> created, <b>{result.users.skipped}</b> already existed</Text>
              <Text size="sm">No longer in the file: <b>{result.stale.count}</b></Text>
            </Stack>
          </Alert>

          {result.stale.count > 0 && <StaleTable rows={result.stale.rows} />}

          {result.errors.length > 0 && (
            <Paper withBorder radius="md" p="md">
              <Title order={6} ff={clubDesign.font.heading} fw={800} mb="xs">Row errors</Title>
              <Table fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>FAN / Email</Table.Th>
                    <Table.Th>Reason</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.errors.map((e, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{e.fanId}</Table.Td>
                      <Table.Td>{e.reason}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          <Box>
            <Button variant="subtle" size="xs" radius="xl" onClick={() => { setResult(null); setFileName(''); clearPreview(); }}>
              Import another file
            </Button>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
