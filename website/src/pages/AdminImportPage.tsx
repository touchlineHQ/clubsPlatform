import { useRef, useState } from 'react';
import {
  Alert, Badge, Box, Button, Center, Group, Loader,
  Paper, ScrollArea, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconFileUpload, IconUsers } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';

interface ParsedPlayerRow {
  fanId: string;
  ageGroup: string;
  teamName: string;
  registrationExpiry: string;
  registrationStatus: string;
  playerEmail: string;
  parentEmails: string[];
}

interface ImportResult {
  ok: boolean;
  players: { created: number; updated: number };
  users: { created: number; skipped: number };
  teams: { stubsCreated: number };
  errors: { fanId: string; reason: string }[];
}

const KNOWN_HEADERS: Record<string, keyof ColIndex> = {
  'fan id':                     'fanId',
  'age group':                  'ageGroup',
  'team':                       'teamName',
  'registration expiry':        'registrationExpiry',
  'registration status':        'registrationStatus',
  'email address':              'playerEmail',
  'parent/carer email address': 'parentEmail',
};

interface ColIndex {
  fanId: number;
  ageGroup: number;
  teamName: number;
  registrationExpiry: number;
  registrationStatus: number;
  playerEmail: number;
  parentEmail: number;
}

function parseSheet(rows: string[][]): { parsed: ParsedPlayerRow[]; errors: string[] } {
  const errors: string[] = [];

  // Find the header row by scanning for a cell matching 'FAN ID'
  const headerRowIdx = rows.findIndex(r =>
    r.some(cell => String(cell ?? '').trim().toLowerCase() === 'fan id')
  );
  if (headerRowIdx === -1) {
    return { parsed: [], errors: ['Could not find a header row containing "FAN ID". Is this an FA Club Player Report?'] };
  }

  const headerRow = rows[headerRowIdx].map(c => String(c ?? '').trim().toLowerCase());
  const colIndex = {} as ColIndex;
  for (const [headerText, key] of Object.entries(KNOWN_HEADERS)) {
    const idx = headerRow.indexOf(headerText);
    if (idx !== -1) colIndex[key] = idx;
  }

  const required: (keyof ColIndex)[] = ['fanId', 'teamName'];
  for (const k of required) {
    if (colIndex[k] === undefined) {
      errors.push(`Required column not found: ${k}`);
    }
  }
  if (errors.length) return { parsed: [], errors };

  const dataRows = rows.slice(headerRowIdx + 1);
  const parsed: ParsedPlayerRow[] = [];

  for (const row of dataRows) {
    const fanId = String(row[colIndex.fanId] ?? '').trim();
    if (!fanId) continue; // skip blank rows

    const parentEmailRaw = String(row[colIndex.parentEmail ?? -1] ?? '').trim();
    const parentEmails = parentEmailRaw
      ? parentEmailRaw.split(',').map(e => e.trim()).filter(Boolean)
      : [];

    parsed.push({
      fanId,
      ageGroup:             String(row[colIndex.ageGroup ?? -1] ?? '').trim(),
      teamName:             String(row[colIndex.teamName] ?? '').trim(),
      registrationExpiry:   String(row[colIndex.registrationExpiry ?? -1] ?? '').trim(),
      registrationStatus:   String(row[colIndex.registrationStatus ?? -1] ?? '').trim(),
      playerEmail:          String(row[colIndex.playerEmail ?? -1] ?? '').trim().toLowerCase(),
      parentEmails,
    });
  }

  return { parsed, errors };
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

export function AdminImportPage() {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug };
  const inputRef = useRef<HTMLInputElement>(null);

  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedPlayerRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [apiError, setApiError] = useState('');

  function handleFile(file: File) {
    setResult(null);
    setApiError('');
    setParseErrors([]);
    setRows(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
        const { parsed, errors } = parseSheet(raw as string[][]);
        if (errors.length) {
          setParseErrors(errors);
        } else {
          setRows(parsed);
        }
      } catch (err) {
        setParseErrors([`Failed to read file: ${String(err)}`]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleConfirm() {
    if (!rows) return;
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
    } catch (err) {
      setApiError(String(err));
    } finally {
      setImporting(false);
    }
  }

  const summary = rows ? summarise(rows) : null;

  return (
    <Stack gap={0}>
      <PageHeader
        title="Import Players"
        subtitle="Upload an FA Club Player Report (CSV or XLSX) to batch-create user accounts"
      />

      <Stack p="md" gap="md">
        {/* Drop zone */}
        {!rows && !result && (
          <Paper
            withBorder
            p="xl"
            style={{ borderStyle: 'dashed', cursor: 'pointer', textAlign: 'center' }}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <Center>
              <Stack align="center" gap="xs">
                <IconFileUpload size={40} color="gray" />
                <Text fw={500}>Drop a file here or click to browse</Text>
                <Text size="sm" c="dimmed">Accepts .csv, .xlsx, .xls (FA Club Player Report)</Text>
              </Stack>
            </Center>
          </Paper>
        )}

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Could not parse file">
            {parseErrors.map((e, i) => <Text key={i} size="sm">{e}</Text>)}
            <Button mt="sm" size="xs" variant="outline" onClick={() => { setParseErrors([]); setFileName(''); }}>
              Try another file
            </Button>
          </Alert>
        )}

        {/* Preview */}
        {rows && summary && (
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Title order={5}>{fileName}</Title>
                <Text size="sm" c="dimmed">Preview — review before importing</Text>
              </div>
              <Button variant="subtle" size="xs" onClick={() => { setRows(null); setFileName(''); }}>
                Change file
              </Button>
            </Group>

            <Group gap="xs">
              <Badge color="blue">{summary.uniqueFans} players</Badge>
              <Badge color="teal">{summary.allEmails} email accounts</Badge>
              <Badge color="grape">{summary.guardianOnlyEmails} guardians</Badge>
              <Badge color="orange">{summary.uniqueTeams} teams</Badge>
            </Group>

            <ScrollArea>
              <Table striped highlightOnHover withTableBorder fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>FAN ID</Table.Th>
                    <Table.Th>Age</Table.Th>
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
                      <Table.Td>{r.ageGroup}</Table.Td>
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

            <Box>
              <Button
                leftSection={importing ? <Loader size={14} color="white" /> : <IconUsers size={16} />}
                onClick={handleConfirm}
                loading={importing}
                disabled={importing}
              >
                Import {rows.length} player{rows.length !== 1 ? 's' : ''}
              </Button>
            </Box>
          </Stack>
        )}

        {/* API error */}
        {apiError && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Import failed">
            {apiError}
          </Alert>
        )}

        {/* Results */}
        {result && (
          <Stack gap="md">
            <Alert
              icon={<IconCheck size={16} />}
              color={result.errors.length ? 'yellow' : 'green'}
              title={result.errors.length ? 'Import completed with warnings' : 'Import successful'}
            >
              <Stack gap={4}>
                <Text size="sm">Players: <b>{result.players.created}</b> created, <b>{result.players.updated}</b> updated</Text>
                <Text size="sm">User accounts: <b>{result.users.created}</b> created, <b>{result.users.skipped}</b> already existed</Text>
                {result.teams.stubsCreated > 0 && (
                  <Text size="sm">Teams: <b>{result.teams.stubsCreated}</b> stub team(s) created for consolidation</Text>
                )}
              </Stack>
            </Alert>

            {result.errors.length > 0 && (
              <Paper withBorder p="md">
                <Title order={6} mb="xs">Row errors</Title>
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
              <Button variant="subtle" size="xs" onClick={() => { setResult(null); setFileName(''); }}>
                Import another file
              </Button>
            </Box>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
