import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Center, Group, Loader, Paper, Select,
  Stack, Table, Text, Tooltip, UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import { clubDesign } from '../../theme';
import type { PlayerPaymentRow } from './types';

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'fanId' | 'teamName' | 'reference' | 'status' | 'date';
type SortDir = 'asc' | 'desc';
interface SortState { key: SortKey; dir: SortDir; }

function compareValues(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sortPayments(rows: PlayerPaymentRow[], sort: SortState): PlayerPaymentRow[] {
  const keyValue = (r: PlayerPaymentRow): string => {
    switch (sort.key) {
      case 'fanId':     return r.fanId;
      case 'teamName':  return r.teamName;
      case 'reference': return r.reference;
      case 'status':    return r.status;
      case 'date':      return String(r.createdAt);
    }
  };
  const sorted = [...rows].sort((a, b) => compareValues(keyValue(a), keyValue(b)));
  return sort.dir === 'asc' ? sorted : sorted.reverse();
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}

function SortHeader({ label, sortKey, sort, onSort }: SortHeaderProps) {
  const active = sort.key === sortKey;
  const Icon = !active ? IconSelector : sort.dir === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <UnstyledButton
      onClick={() => onSort(sortKey)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
    >
      <span>{label}</span>
      <Icon size={12} stroke={2} opacity={active ? 1 : 0.5} />
    </UnstyledButton>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

const ALL = '__all__';
interface PaymentFilters { team: string; status: string; }

const STATUS_OPTIONS = [
  { value: ALL,          label: 'All statuses' },
  { value: 'active',     label: 'Active' },
  { value: 'mandate_only', label: 'Mandate only' },
  { value: 'inactive',   label: 'Inactive' },
];

function applyFilters(rows: PlayerPaymentRow[], filters: PaymentFilters): PlayerPaymentRow[] {
  return rows.filter(r => {
    if (filters.team   !== ALL && r.teamName !== filters.team)   return false;
    if (filters.status !== ALL && r.status   !== filters.status) return false;
    return true;
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const BADGE_STYLES = { label: { textBoxTrim: 'none', textBoxEdge: 'auto' } } as const;

function StatusBadge({ status }: { status: string }) {
  const color  = status === 'active' ? 'green' : status === 'inactive' ? 'red' : 'orange';
  const label  = status === 'active' ? 'Active' : status === 'inactive' ? 'Inactive' : 'Mandate only';
  return <Badge size="sm" variant="light" color={color} radius="xl" styles={BADGE_STYLES}>{label}</Badge>;
}

// ─── Deactivate action ────────────────────────────────────────────────────────

interface DeactivateActionProps {
  payment: PlayerPaymentRow;
  confirmId: string | null;
  deactivatingId: string | null;
  onRequest: (id: string) => void;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}

function DeactivateAction({ payment, confirmId, deactivatingId, onRequest, onConfirm, onCancel }: DeactivateActionProps) {
  if (payment.status === 'inactive') return null;
  if (confirmId === payment.id) {
    return (
      <Group gap="xs">
        <Button size="xs" color="red" variant="filled" loading={deactivatingId === payment.id} onClick={() => onConfirm(payment.id)}>
          Confirm
        </Button>
        <Button size="xs" variant="subtle" onClick={onCancel}>Cancel</Button>
      </Group>
    );
  }
  return (
    <Button size="xs" color="orange" variant="subtle" onClick={() => onRequest(payment.id)}>
      Deactivate
    </Button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  clubHeaders: HeadersInit;
}

export function PaymentRecordsTab({ clubHeaders }: Props) {
  const [payments, setPayments]   = useState<PlayerPaymentRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filters, setFilters]     = useState<PaymentFilters>({ team: ALL, status: ALL });
  const [sort, setSort]           = useState<SortState>({ key: 'date', dir: 'desc' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    fetch('/api/admin/player-payments', { headers: clubHeaders })
      .then(r => r.ok ? r.json() as Promise<{ payments: PlayerPaymentRow[] }> : Promise.reject())
      .then(d => setPayments(d.payments))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (key: SortKey) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };

  const handleDeactivate = async (id: string) => {
    setDeactivatingId(id);
    try {
      const res = await fetch('/api/admin/player-payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setPayments(prev => prev.map(p => p.id === id ? { ...p, status: 'inactive' } : p));
      }
    } finally {
      setDeactivatingId(null);
      setConfirmId(null);
    }
  };

  const teamOptions = useMemo(() => {
    const teams = Array.from(new Set(payments.map(p => p.teamName).filter(Boolean))).sort();
    return [{ value: ALL, label: 'All teams' }, ...teams.map(t => ({ value: t, label: t }))];
  }, [payments]);

  const visiblePayments = useMemo(
    () => sortPayments(applyFilters(payments, filters), sort),
    [payments, filters, sort],
  );

  const headerProps = { sort, onSort: handleSort };
  const deactivateProps = {
    confirmId,
    deactivatingId,
    onRequest: (id: string) => setConfirmId(id),
    onConfirm: handleDeactivate,
    onCancel:  () => setConfirmId(null),
  };

  if (loading) {
    return <Center h={120}><Loader size="sm" /></Center>;
  }

  const filterBar = (
    <Group gap="sm" wrap="wrap">
      <Select
        size="xs"
        w={180}
        value={filters.team}
        onChange={v => setFilters(f => ({ ...f, team: v ?? ALL }))}
        data={teamOptions}
        aria-label="Filter by team"
      />
      <Select
        size="xs"
        w={180}
        value={filters.status}
        onChange={v => setFilters(f => ({ ...f, status: v ?? ALL }))}
        data={STATUS_OPTIONS}
        aria-label="Filter by status"
      />
      {(filters.team !== ALL || filters.status !== ALL) && (
        <Button size="xs" variant="subtle" onClick={() => setFilters({ team: ALL, status: ALL })}>
          Clear
        </Button>
      )}
    </Group>
  );

  if (payments.length === 0) {
    return (
      <Stack gap="md">
        {filterBar}
        <Box
          p="xl"
          style={{
            background: clubDesign.color.n1,
            border: `1px dashed ${clubDesign.color.n3}`,
            borderRadius: clubDesign.radius.card,
            textAlign: 'center',
          }}
        >
          <Text size="sm" c="dimmed">No payment records yet.</Text>
        </Box>
      </Stack>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="md">
        {filterBar}
        {visiblePayments.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center">No payments match your filters.</Text>
        ) : (
          <Stack gap="sm">
            {visiblePayments.map(p => (
              <Paper key={p.id} withBorder radius="md" p="md">
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={2}>
                      <Text fw={700} size="sm">{p.teamName}</Text>
                      <Text size="xs" c="dimmed" ff="monospace">{p.fanId}</Text>
                    </Stack>
                    <StatusBadge status={p.status} />
                  </Group>
                  <Tooltip label={p.reference} withArrow>
                    <Text size="xs" ff="monospace" c="dimmed" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.reference}
                    </Text>
                  </Tooltip>
                  <Text size="xs" c="dimmed">{new Date(p.createdAt).toLocaleDateString('en-GB')}</Text>
                  <DeactivateAction payment={p} {...deactivateProps} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {filterBar}
      {visiblePayments.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">No payments match your filters.</Text>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
          <Table striped highlightOnHover fz="sm" miw={860}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th><SortHeader label="FAN" sortKey="fanId" {...headerProps} /></Table.Th>
                <Table.Th><SortHeader label="Team" sortKey="teamName" {...headerProps} /></Table.Th>
                <Table.Th><SortHeader label="Reference" sortKey="reference" {...headerProps} /></Table.Th>
                <Table.Th><SortHeader label="Status" sortKey="status" {...headerProps} /></Table.Th>
                <Table.Th><SortHeader label="Date" sortKey="date" {...headerProps} /></Table.Th>
                <Table.Th aria-label="Actions" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visiblePayments.map(p => (
                <Table.Tr key={p.id}>
                  <Table.Td><Text size="sm" ff="monospace" fw={600}>{p.fanId}</Text></Table.Td>
                  <Table.Td><Text size="sm">{p.teamName}</Text></Table.Td>
                  <Table.Td>
                    <Tooltip label={p.reference} withArrow>
                      <Text size="sm" ff="monospace" c="dimmed" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.reference}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td><StatusBadge status={p.status} /></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{new Date(p.createdAt).toLocaleDateString('en-GB')}</Text></Table.Td>
                  <Table.Td style={{ width: 1 }}>
                    <DeactivateAction payment={p} {...deactivateProps} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
