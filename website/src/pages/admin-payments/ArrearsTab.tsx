import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Center, Checkbox, Group, Loader, Paper, Select, Stack, Table, Text,
} from '@mantine/core';
import { IconHistory, IconMailForward } from '@tabler/icons-react';
import { captureError } from '../../lib/posthog';

/** Arrears (#77): who is outstanding, why, who a reminder can reach, and who has been chased. */

type Reason = 'failed_payment' | 'no_payment' | 'mandate_only' | 'cancelled';

export interface ArrearsRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  registeredAt: number;
  subscriptionLevelName: string | null;
  reason: Reason;
  failedAt: number | null;
  failureCause: string | null;
  reachableContacts: number;
  objectedContacts: number;
  pendingContacts: number;
  unreachableContacts: number;
  lastChasedAt: number | null;
  chaseCount: number;
}

interface HistoryEntry { at: number; by: string; template: string | null; sent: number | null; dropped: number | null; reasons: string[] }

const REASON_LABEL: Record<Reason, { label: string; color: string }> = {
  failed_payment: { label: 'Direct Debit failed', color: 'red' },
  no_payment: { label: 'No payment set up', color: 'orange' },
  mandate_only: { label: 'Mandate, no subscription', color: 'yellow' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};

const OVERDUE_OPTIONS = [
  { value: '', label: 'Any age' },
  { value: '14', label: 'Registered 14+ days ago' },
  { value: '30', label: 'Registered 30+ days ago' },
  { value: '60', label: 'Registered 60+ days ago' },
];

const TEMPLATE_OPTIONS = [
  { value: 'outstanding', label: 'Subscription outstanding' },
  { value: 'failed_payment', label: 'Payment failed' },
];

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function excludedText(r: ArrearsRow): string | null {
  const parts: string[] = [];
  if (r.objectedContacts) parts.push(`${r.objectedContacts} objected to club emails`);
  if (r.pendingContacts) parts.push(`${r.pendingContacts} not activated`);
  if (r.unreachableContacts) parts.push(`${r.unreachableContacts} withdrawn or bounced`);
  return parts.length ? `Excluded: ${parts.join(', ')}` : null;
}

export function ArrearsTab({ clubHeaders: rawHeaders }: { clubHeaders: HeadersInit }) {
  // The parent builds a fresh headers object every render; key on its content
  // so the loaders below don't refetch in a loop.
  const headersKey = JSON.stringify(rawHeaders);
  const clubHeaders = useMemo(() => JSON.parse(headersKey) as Record<string, string>, [headersKey]);
  const [teams, setTeams] = useState<string[]>([]);
  const [team, setTeam] = useState<string>('');
  const [minDays, setMinDays] = useState<string>('');
  const [rows, setRows] = useState<ArrearsRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<string>('outstanding');
  const [sending, setSending] = useState(false);
  const [sendSummary, setSendSummary] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryEntry[] | 'loading'>>({});

  useEffect(() => {
    fetch('/api/admin/registration-facets', { headers: clubHeaders })
      .then(r => (r.ok ? r.json() : { teams: [] }))
      .then((d: { teams?: string[] }) => setTeams(d.teams ?? []))
      .catch(() => setTeams([]));
  }, [clubHeaders]);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const qs = new URLSearchParams();
    if (team) qs.set('team', team);
    if (minDays) qs.set('minDays', minDays);
    try {
      const res = await fetch(`/api/admin/arrears?${qs}`, { headers: clubHeaders });
      if (!res.ok) throw new Error(`Failed to load arrears (${res.status})`);
      const d = await res.json() as { rows: ArrearsRow[]; truncated: boolean };
      setRows(d.rows);
      setTruncated(d.truncated);
      setSelected(new Set());
    } catch (e) {
      captureError(e, { op: 'arrears.load' });
      setError(e instanceof Error ? e.message : 'Failed to load arrears');
      setRows([]);
    }
  }, [team, minDays, clubHeaders]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async () => {
    setSending(true);
    setSendSummary(null);
    try {
      // The server takes at most 100 registrations per request; a club-wide
      // select-all can be 500, so send in chunks and add the results up.
      const ids = [...selected];
      const results: Array<{ sent: number; dropped: unknown[]; mailConfigured: boolean }> = [];
      let skipped = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const res = await fetch('/api/admin/arrears-reminders', {
          method: 'POST',
          headers: { ...clubHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationIds: ids.slice(i, i + 100), template }),
        });
        const d = await res.json().catch(() => ({})) as {
          error?: string;
          results?: Array<{ sent: number; dropped: unknown[]; mailConfigured: boolean }>;
          skipped?: unknown[];
        };
        if (!res.ok || !d.results) throw new Error(d.error ?? 'Sending failed');
        results.push(...d.results);
        skipped += d.skipped?.length ?? 0;
      }
      const sent = results.reduce((n, r) => n + r.sent, 0);
      const dropped = results.reduce((n, r) => n + r.dropped.length, 0);
      const configured = results.every(r => r.mailConfigured);
      const skippedText = skipped ? ` ${skipped} skipped: no failed payment on record.` : '';
      setSendSummary((configured
        ? `Reminders sent to ${sent} contact${sent === 1 ? '' : 's'} for ${results.length} registration${results.length === 1 ? '' : 's'}${dropped ? `; ${dropped} excluded` : ''}.`
        : 'Email is not set up for this club yet, so nothing was sent. The attempt is still recorded.') + skippedText);
      setHistory({});
      await load();
    } catch (e) {
      setSendSummary(e instanceof Error ? e.message : 'Sending failed');
    } finally {
      setSending(false);
    }
  };

  const showHistory = async (id: string) => {
    if (history[id]) {
      setHistory(h => { const { [id]: _, ...rest } = h; return rest; });
      return;
    }
    setHistory(h => ({ ...h, [id]: 'loading' }));
    const res = await fetch(`/api/admin/arrears-reminders?registrationId=${encodeURIComponent(id)}`, { headers: clubHeaders });
    const d = res.ok ? await res.json() as { history: HistoryEntry[] } : { history: [] };
    setHistory(h => ({ ...h, [id]: d.history }));
  };

  return (
    <Stack gap="md">
      <Paper p="md" withBorder radius="md">
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Team"
            data={[{ value: '', label: 'All teams' }, ...teams.map(t => ({ value: t, label: t }))]}
            value={team}
            onChange={v => setTeam(v ?? '')}
            allowDeselect={false}
            w={220}
          />
          <Select label="How overdue" data={OVERDUE_OPTIONS} value={minDays} onChange={v => setMinDays(v ?? '')} allowDeselect={false} w={240} />
          <Select label="Reminder" data={TEMPLATE_OPTIONS} value={template} onChange={v => setTemplate(v ?? 'outstanding')} allowDeselect={false} w={220} />
          <Button
            leftSection={<IconMailForward size={14} />}
            disabled={selected.size === 0}
            loading={sending}
            onClick={send}
          >
            Send reminder{selected.size ? ` (${selected.size})` : ''}
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Reminders only go to contacts who have activated their email and haven't objected to club emails. Everyone
          else is listed as excluded.
        </Text>
      </Paper>

      {sendSummary && <Alert variant="light">{sendSummary}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      {truncated && <Alert color="yellow">Showing the first 500. Pick a team to see the rest.</Alert>}

      {rows === null ? (
        <Center py="xl"><Loader /></Center>
      ) : rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="lg">Nobody is outstanding for this selection.</Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <Checkbox
                    aria-label="Select all"
                    checked={selected.size === rows.length}
                    indeterminate={selected.size > 0 && selected.size < rows.length}
                    onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map(r => r.registrationId)))}
                  />
                </Table.Th>
                <Table.Th>FAN</Table.Th>
                <Table.Th>Team</Table.Th>
                <Table.Th>Why</Table.Th>
                <Table.Th>Contacts</Table.Th>
                <Table.Th>Last chased</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(r => {
                const reason = REASON_LABEL[r.reason];
                const excluded = excludedText(r);
                const h = history[r.registrationId];
                return [
                  <Table.Tr key={r.registrationId}>
                    <Table.Td>
                      <Checkbox
                        aria-label={`Select ${r.fanId}`}
                        checked={selected.has(r.registrationId)}
                        onChange={() => toggle(r.registrationId)}
                      />
                    </Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{r.fanId}</Text></Table.Td>
                    <Table.Td>
                      <Text size="sm">{r.teamName}</Text>
                      <Text size="xs" c="dimmed">Registered {fmtDate(r.registeredAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={reason.color} variant="light">{reason.label}</Badge>
                      {r.failedAt && (
                        <Text size="xs" c="dimmed">{fmtDate(r.failedAt)}{r.failureCause ? `: ${r.failureCause.replace(/_/g, ' ')}` : ''}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{r.reachableContacts} reachable</Text>
                      {excluded && <Text size="xs" c="orange.8">{excluded}</Text>}
                    </Table.Td>
                    <Table.Td>
                      {r.chaseCount > 0 && r.lastChasedAt ? (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          leftSection={<IconHistory size={12} />}
                          onClick={() => showHistory(r.registrationId)}
                        >
                          {fmtDate(r.lastChasedAt)} ({r.chaseCount})
                        </Button>
                      ) : (
                        <Text size="xs" c="dimmed">Never</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>,
                  h ? (
                    <Table.Tr key={`${r.registrationId}-history`}>
                      <Table.Td />
                      <Table.Td colSpan={5}>
                        {h === 'loading' ? <Loader size="xs" /> : (
                          <Stack gap={2}>
                            {h.map(e => (
                              <Text size="xs" key={`${e.at}-${e.by}`}>
                                {fmtDate(e.at)} by {e.by}: {e.template === 'failed_payment' ? 'payment failed' : 'outstanding'} reminder,
                                {' '}{e.sent ?? 0} sent{e.dropped ? `, ${e.dropped} excluded (${e.reasons.join(', ').replace(/_/g, ' ')})` : ''}
                              </Text>
                            ))}
                          </Stack>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ) : null,
                ];
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
