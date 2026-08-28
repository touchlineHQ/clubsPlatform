import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text, Paper, Box, Group, Button, UnstyledButton,
  Select, ActionIcon, Modal, Tooltip, Tabs, Textarea,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowRight, IconChevronDown, IconChevronUp, IconFileSpreadsheet, IconFileUpload,
  IconSelector, IconTrash, IconUserCheck,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';
import { ImportPlayersPanel } from './admin-users/ImportPlayersPanel';

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
  // Manual override attribution — admin (club) rows only; never sent to players.
  manualPaidBy?: string | null;
  manualPaidAt?: number | null;
  manualNote?: string | null;
}

interface SubscriptionLevel {
  id: string;
  name: string;
}

interface Response {
  personal: RegistrationRow[];
  club: RegistrationRow[] | null;
  scope: 'admin' | 'user';
}

const DEFAULT_VALUE = '__default__';

type SortKey = 'fanId' | 'teamName' | 'registrationExpiry' | 'registrationStatus' | 'subscription' | 'subscriptionLevel' | 'sixthCol';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

type SubStatus = 'paid' | 'setup' | 'outstanding' | 'cancelled';

interface SubStatusInfo {
  status: SubStatus;
  label: string;
  color: string;
}

function getSubscriptionStatus(row: RegistrationRow): SubStatusInfo {
  switch (row.paymentStatus) {
    case 'active':
    // A manual admin override is a paid player — identical badge, so filtering,
    // sorting and the export all treat them the same. Only the admin table adds
    // a marker showing who overrode it.
    case 'manual':
      return { status: 'paid', label: 'Paid', color: 'green' };
    case 'pending':
      return { status: 'setup', label: 'Mandate set up', color: 'blue' };
    case 'inactive':
      return { status: 'cancelled', label: 'Cancelled', color: 'red' };
    default:
      return { status: 'outstanding', label: 'Outstanding', color: 'orange' };
  }
}

function compareValues(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ?? '';
  const bv = b ?? '';
  if (av === bv) return 0;
  if (av === '') return 1;
  if (bv === '') return -1;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(rows: RegistrationRow[], sort: SortState, sixthIsLinkedAccounts: boolean): RegistrationRow[] {
  const sixthValue = (r: RegistrationRow) =>
    sixthIsLinkedAccounts
      ? (r.linkedAccounts?.split(',')[0]?.split('|')[0] ?? '')
      : (r.relationship ?? '');

  const keyValue = (r: RegistrationRow): string => {
    switch (sort.key) {
      case 'fanId': return r.fanId;
      case 'teamName': return r.teamName;
      case 'registrationExpiry': return r.registrationExpiry ?? '';
      case 'registrationStatus': return r.registrationStatus ?? '';
      case 'subscription': return getSubscriptionStatus(r).label;
      case 'subscriptionLevel': return r.subscriptionLevelName ?? '';
      case 'sixthCol': return sixthValue(r);
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

const BADGE_STYLES = {
  label: { textBoxTrim: 'none', textBoxEdge: 'auto' },
} as const;

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <Text size="sm">—</Text>;
  return (
    <Badge
      size="sm"
      variant="light"
      color={value.toLowerCase().includes('registered') ? 'green' : 'orange'}
      radius="xl"
      styles={BADGE_STYLES}
    >
      {value}
    </Badge>
  );
}

function manualOverrideTooltip(row: RegistrationRow): string {
  const who = row.manualPaidBy ?? 'an admin';
  const when = row.manualPaidAt
    ? ` on ${new Date(row.manualPaidAt).toLocaleDateString('en-GB')}`
    : '';
  return `Marked as paid by ${who}${when}${row.manualNote ? ` — ${row.manualNote}` : ''}`;
}

/**
 * `showManualMarker` is passed only by the admin club table. Player-facing rows
 * render the plain green badge, so a manually-paid player looks exactly like a
 * Direct Debit payer.
 */
function SubscriptionBadge({ row, showManualMarker }: { row: RegistrationRow; showManualMarker?: boolean }) {
  const info = getSubscriptionStatus(row);
  const badge = (
    <Badge size="sm" variant="light" color={info.color} radius="xl" styles={BADGE_STYLES}>
      {info.label}
    </Badge>
  );

  if (!showManualMarker || row.paymentStatus !== 'manual') return badge;

  return (
    <Group gap={4} wrap="nowrap" align="center">
      {badge}
      <Tooltip label={manualOverrideTooltip(row)} withArrow multiline w={260}>
        <IconUserCheck
          size={14}
          stroke={2}
          aria-label="Manually marked as paid"
          style={{ color: 'var(--mantine-color-teal-7)', flexShrink: 0 }}
        />
      </Tooltip>
    </Group>
  );
}

function LinkedAccountsCell({ row }: { row: RegistrationRow }) {
  if (!row.linkedAccounts) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {row.linkedAccounts.split(',').map((pair, i) => {
        const [email, rel] = pair.split('|');
        return (
          <Badge
            key={i}
            size="xs"
            variant="light"
            color={rel === 'self' ? 'blue' : 'grape'}
            radius="xl"
            title={rel}
            styles={BADGE_STYLES}
          >
            {email}
          </Badge>
        );
      })}
    </Group>
  );
}

interface SubscriptionLevelCellProps {
  row: RegistrationRow;
  levels: SubscriptionLevel[];
  updating: boolean;
  onChange: (row: RegistrationRow, levelId: string | null) => void;
}

function SubscriptionLevelCell({ row, levels, updating, onChange }: SubscriptionLevelCellProps) {
  const data = useMemo(
    () => [
      { value: DEFAULT_VALUE, label: 'Use team default' },
      ...levels.map(l => ({ value: l.id, label: l.name })),
    ],
    [levels],
  );

  const overridden = row.overrideLevelId !== null;
  const value = row.overrideLevelId ?? DEFAULT_VALUE;
  const resolvedLabel = row.subscriptionLevelName ?? 'No level set';

  return (
    <Tooltip
      label="Override applies to new payment setups only — existing active subscriptions are unchanged."
      withArrow
      multiline
      w={260}
    >
      <Box>
        <Select
          size="xs"
          w={170}
          data={data}
          value={value}
          disabled={updating || levels.length === 0}
          onChange={v => onChange(row, v === DEFAULT_VALUE ? null : v)}
          aria-label={`Subscription level for ${row.fanId}`}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <Text size="xs" c="dimmed" mt={2}>
          {overridden ? 'Override' : `Default · ${resolvedLabel}`}
        </Text>
      </Box>
    </Tooltip>
  );
}

function RelationshipBadge({ value }: { value: string | null }) {
  if (!value) return <Text size="sm">—</Text>;
  return (
    <Badge
      size="sm"
      variant="light"
      color={value === 'self' ? 'blue' : 'grape'}
      radius="xl"
      tt="capitalize"
      styles={BADGE_STYLES}
    >
      {value}
    </Badge>
  );
}

interface ManualPaymentProps {
  busyId: string | null;
  onMark: (row: RegistrationRow) => void;
  onUnmark: (row: RegistrationRow) => void;
}

/**
 * Mirrors the rule enforced by POST /api/admin/manual-payment: a registration
 * with a live GoCardless mandate ('pending') or subscription ('active') can
 * never be overridden, because deactivating a payment does not stop GoCardless
 * collecting. Hiding the button there keeps admins from meeting the 409.
 */
function ManualPaymentAction({ row, busyId, onMark, onUnmark }: ManualPaymentProps & { row: RegistrationRow }) {
  const busy = busyId === row.registrationId;

  if (row.paymentStatus === 'manual') {
    return (
      <Tooltip label="Remove the manual override and return this player to Outstanding" withArrow>
        <Button size="xs" variant="subtle" color="orange" loading={busy} onClick={() => onUnmark(row)}>
          Undo paid
        </Button>
      </Tooltip>
    );
  }

  if (row.paymentStatus === 'active' || row.paymentStatus === 'pending') return null;

  return (
    <Tooltip label="Record this player as paid outside GoCardless — cash, bank transfer, sponsored place" withArrow multiline w={240}>
      <Button size="xs" variant="subtle" color="green" loading={busy} onClick={() => onMark(row)}>
        Mark as paid
      </Button>
    </Tooltip>
  );
}

interface TableProps {
  rows: RegistrationRow[];
  sixthHeader: 'Linked accounts' | 'Relationship';
  canDelete: boolean;
  onDelete?: (row: RegistrationRow) => void;
  editableLevels?: {
    levels: SubscriptionLevel[];
    updatingId: string | null;
    onChange: (row: RegistrationRow, levelId: string | null) => void;
  };
  manualPayment?: ManualPaymentProps;
}

function RegistrationsTable({ rows, sixthHeader, canDelete, onDelete, editableLevels, manualPayment }: TableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'teamName', dir: 'asc' });
  const sixthIsLinkedAccounts = sixthHeader === 'Linked accounts';
  const isMobile = useMediaQuery('(max-width: 768px)');

  const sortedRows = useMemo(
    () => sortRows(rows, sort, sixthIsLinkedAccounts),
    [rows, sort, sixthIsLinkedAccounts],
  );

  const handleSort = (key: SortKey) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };

  const headerProps = { sort, onSort: handleSort };

  if (isMobile) {
    return (
      <Stack gap="sm">
        {sortedRows.map(r => (
          <Paper key={r.registrationId} withBorder radius="md" p="md">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={2}>
                  <Text fw={700} size="sm">{r.teamName}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">{r.fanId}</Text>
                </Stack>
                {canDelete && onDelete && (
                  <Tooltip label="Remove registration">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => onDelete(r)}
                      aria-label="Remove registration"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
              <Group gap={6} wrap="wrap">
                <StatusBadge value={r.registrationStatus} />
                <SubscriptionBadge row={r} showManualMarker={!!manualPayment} />
              </Group>
              {manualPayment && <ManualPaymentAction row={r} {...manualPayment} />}
              <Text size="xs" c="dimmed"><b>Expiry:</b> {r.registrationExpiry || '—'}</Text>
              {editableLevels && (
                <Box>
                  <Text size="xs" c="dimmed" mb={2}>Level</Text>
                  <SubscriptionLevelCell
                    row={r}
                    levels={editableLevels.levels}
                    updating={editableLevels.updatingId === r.registrationId}
                    onChange={editableLevels.onChange}
                  />
                </Box>
              )}
              <Box>
                <Text size="xs" c="dimmed" mb={2}>{sixthHeader}</Text>
                {sixthIsLinkedAccounts
                  ? <LinkedAccountsCell row={r} />
                  : <RelationshipBadge value={r.relationship} />}
              </Box>
            </Stack>
          </Paper>
        ))}
      </Stack>
    );
  }

  const miw = (canDelete
    ? (editableLevels ? 1060 : 880)
    : (editableLevels ? 1000 : 820)) + (manualPayment ? 120 : 0);

  return (
    <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
      <Table striped highlightOnHover fz="sm" miw={miw}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th><SortHeader label="FAN ID" sortKey="fanId" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Team" sortKey="teamName" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Expiry" sortKey="registrationExpiry" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Status" sortKey="registrationStatus" {...headerProps} /></Table.Th>
            {editableLevels && (
              <Table.Th><SortHeader label="Level" sortKey="subscriptionLevel" {...headerProps} /></Table.Th>
            )}
            <Table.Th><SortHeader label="Subscription" sortKey="subscription" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label={sixthHeader} sortKey="sixthCol" {...headerProps} /></Table.Th>
            {canDelete && <Table.Th aria-label="Actions" />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedRows.map(r => (
            <Table.Tr key={r.registrationId}>
              <Table.Td>
                <Text size="sm" ff="monospace">{r.fanId}</Text>
              </Table.Td>
              <Table.Td><Text size="sm">{r.teamName}</Text></Table.Td>
              <Table.Td><Text size="sm">{r.registrationExpiry || '—'}</Text></Table.Td>
              <Table.Td><StatusBadge value={r.registrationStatus} /></Table.Td>
              {editableLevels && (
                <Table.Td>
                  <SubscriptionLevelCell
                    row={r}
                    levels={editableLevels.levels}
                    updating={editableLevels.updatingId === r.registrationId}
                    onChange={editableLevels.onChange}
                  />
                </Table.Td>
              )}
              <Table.Td><SubscriptionBadge row={r} showManualMarker={!!manualPayment} /></Table.Td>
              <Table.Td>
                {sixthIsLinkedAccounts
                  ? <LinkedAccountsCell row={r} />
                  : <RelationshipBadge value={r.relationship} />}
              </Table.Td>
              {canDelete && onDelete && (
                <Table.Td style={{ width: 1 }}>
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                    {manualPayment && <ManualPaymentAction row={r} {...manualPayment} />}
                    <Tooltip label="Remove registration">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => onDelete(r)}
                        aria-label="Remove registration"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

interface ClubFilters {
  team: string;
  status: string;
  subscription: string;
}

const ALL = '__all__';

interface ClubFilterBarProps {
  rows: RegistrationRow[];
  filters: ClubFilters;
  onChange: (next: ClubFilters) => void;
}

function ClubFilterBar({ rows, filters, onChange }: ClubFilterBarProps) {
  const teamOptions = useMemo(() => {
    const teams = Array.from(new Set(rows.map(r => r.teamName).filter(Boolean))).sort();
    return [{ value: ALL, label: 'All teams' }, ...teams.map(t => ({ value: t, label: t }))];
  }, [rows]);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(rows.map(r => r.registrationStatus).filter((s): s is string => !!s))).sort();
    return [{ value: ALL, label: 'All statuses' }, ...statuses.map(s => ({ value: s, label: s }))];
  }, [rows]);

  const subscriptionOptions: { value: string; label: string }[] = [
    { value: ALL, label: 'All subscriptions' },
    { value: 'paid', label: 'Paid' },
    { value: 'setup', label: 'Mandate set up' },
    { value: 'outstanding', label: 'Outstanding' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <Group gap="sm" wrap="wrap">
      <Select
        size="xs"
        w={180}
        value={filters.team}
        onChange={v => onChange({ ...filters, team: v ?? ALL })}
        data={teamOptions}
        aria-label="Filter by team"
      />
      <Select
        size="xs"
        w={180}
        value={filters.status}
        onChange={v => onChange({ ...filters, status: v ?? ALL })}
        data={statusOptions}
        aria-label="Filter by status"
      />
      <Select
        size="xs"
        w={200}
        value={filters.subscription}
        onChange={v => onChange({ ...filters, subscription: v ?? ALL })}
        data={subscriptionOptions}
        aria-label="Filter by subscription status"
      />
      {(filters.team !== ALL || filters.status !== ALL || filters.subscription !== ALL) && (
        <Button
          size="xs"
          variant="subtle"
          onClick={() => onChange({ team: ALL, status: ALL, subscription: ALL })}
        >
          Clear
        </Button>
      )}
    </Group>
  );
}

function applyClubFilters(rows: RegistrationRow[], filters: ClubFilters): RegistrationRow[] {
  return rows.filter(r => {
    if (filters.team !== ALL && r.teamName !== filters.team) return false;
    if (filters.status !== ALL && (r.registrationStatus ?? '') !== filters.status) return false;
    if (filters.subscription !== ALL && getSubscriptionStatus(r).status !== filters.subscription) return false;
    return true;
  });
}

function EmptyState({ isAdmin, scope }: { isAdmin: boolean; scope: 'personal' | 'club' }) {
  return (
    <Box
      p="xl"
      style={{
        background: clubDesign.color.n1,
        border: `1px dashed ${clubDesign.color.n3}`,
        borderRadius: clubDesign.radius.card,
        textAlign: 'center',
      }}
    >
      <Stack align="center" gap="sm">
        <Text fw={700} ff={clubDesign.font.heading}>
          {scope === 'club'
            ? 'No registrations yet for this club.'
            : 'No registrations linked to your account yet.'}
        </Text>
        {scope === 'personal' && !isAdmin && (
          <>
            <Text size="sm" c="dimmed" maw={460}>
              If you've registered with the club, our admins will link your account to your
              player record. In the meantime, you can register or renew below.
            </Text>
            <Button
              component={Link}
              to="/register"
              radius="xl"
              rightSection={<IconArrowRight size={14} />}
            >
              Register &amp; Pay
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}

function buildPaymentLink(origin: string, clubSlug: string, fanId: string): string {
  return `${origin}/${clubSlug}/payments/SUBS/${encodeURIComponent(fanId)}`;
}

function exportRegistrationsToXlsx(
  rows: RegistrationRow[],
  clubSlug: string,
  filters: ClubFilters,
) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const data = rows.map(r => ({
    'FAN ID':            r.fanId,
    'Team':              r.teamName,
    'Status':            r.registrationStatus ?? '',
    'Expiry':            r.registrationExpiry ?? '',
    'Linked Accounts':   r.linkedAccounts ?? '',
    'Subscription Level': r.subscriptionLevelName ?? '',
    'Subscription Status': getSubscriptionStatus(r).label,
    'Marked Paid By':    r.manualPaidBy ?? '',
    'Payment Link':      buildPaymentLink(origin, clubSlug, r.fanId),
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 12 }, // FAN ID
    { wch: 22 }, // Team
    { wch: 14 }, // Status
    { wch: 12 }, // Expiry
    { wch: 38 }, // Linked Accounts
    { wch: 22 }, // Subscription Level
    { wch: 18 }, // Subscription Status
    { wch: 28 }, // Marked Paid By
    { wch: 60 }, // Payment Link
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registrations');

  const today = new Date().toISOString().slice(0, 10);
  const filterSuffix = [
    filters.team         !== ALL ? filters.team         : null,
    filters.status       !== ALL ? filters.status       : null,
    filters.subscription !== ALL ? filters.subscription : null,
  ].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]+/g, '_');

  const fileSlug = clubSlug || 'club';
  const filename = filterSuffix
    ? `${fileSlug}-registrations-${filterSuffix}-${today}.xlsx`
    : `${fileSlug}-registrations-${today}.xlsx`;

  XLSX.writeFile(wb, filename);
}

export function RegistrationsPage() {
  const { clubSlug } = useClub();
  const [personal, setPersonal] = useState<RegistrationRow[]>([]);
  const [club, setClub] = useState<RegistrationRow[] | null>(null);
  const [scope, setScope] = useState<'admin' | 'user'>('user');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<ClubFilters>({ team: ALL, status: ALL, subscription: ALL });
  const [pendingDelete, setPendingDelete] = useState<RegistrationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);
  const [levels, setLevels] = useState<SubscriptionLevel[]>([]);
  const [updatingLevelId, setUpdatingLevelId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState('');
  const [pendingManual, setPendingManual] = useState<RegistrationRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);
  const [manualError, setManualError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/my-registrations', {
        headers: { 'X-Club-Slug': clubSlug },
      });
      if (!res.ok) throw new Error('Failed to load registrations');
      const data = await res.json() as Response;
      setPersonal(data.personal);
      setClub(data.club);
      setScope(data.scope);
    } catch {
      setError('Failed to load registrations');
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  const isAdmin = scope === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/subscription-levels', {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) return;
        const data = await res.json() as { levels?: SubscriptionLevel[] };
        if (!cancelled) setLevels(Array.isArray(data.levels) ? data.levels : []);
      } catch {
        // Non-fatal — the Select will just be disabled.
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, clubSlug]);

  const handleLevelChange = useCallback(async (row: RegistrationRow, levelId: string | null) => {
    setUpdatingLevelId(row.registrationId);
    setLevelError('');
    const prevOverride = row.overrideLevelId;
    const prevResolvedId = row.subscriptionLevelId;
    const prevResolvedName = row.subscriptionLevelName;
    const newName = levelId
      ? (levels.find(l => l.id === levelId)?.name ?? null)
      : null;
    // Optimistic update — patch override + resolved fields for this row.
    setClub(rows => rows ? rows.map(r => r.registrationId === row.registrationId
      ? {
          ...r,
          overrideLevelId: levelId,
          subscriptionLevelId: levelId ?? r.subscriptionLevelId,
          subscriptionLevelName: levelId ? newName : r.subscriptionLevelName,
        }
      : r,
    ) : rows);
    try {
      const res = await fetch('/api/admin/registration-subscription-levels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Club-Slug': clubSlug,
        },
        body: JSON.stringify({
          registrationId: row.registrationId,
          subscriptionLevelId: levelId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to update subscription level');
      }
      // Refresh in the background to pick up the authoritative resolved level
      // (e.g. when clearing an override and a status/team rule kicks in).
      refresh();
    } catch (e) {
      setLevelError(e instanceof Error ? e.message : 'Failed to update subscription level');
      // Roll back the optimistic update.
      setClub(rows => rows ? rows.map(r => r.registrationId === row.registrationId
        ? {
            ...r,
            overrideLevelId: prevOverride,
            subscriptionLevelId: prevResolvedId,
            subscriptionLevelName: prevResolvedName,
          }
        : r,
      ) : rows);
    } finally {
      setUpdatingLevelId(null);
    }
  }, [clubSlug, levels, refresh]);

  const openManualModal = useCallback((row: RegistrationRow) => {
    setManualNote('');
    setManualError('');
    setPendingManual(row);
  }, []);

  const closeManualModal = () => {
    if (manualBusyId) return;
    setPendingManual(null);
    setManualNote('');
    setManualError('');
  };

  const handleConfirmMarkPaid = async () => {
    if (!pendingManual) return;
    setManualBusyId(pendingManual.registrationId);
    setManualError('');
    try {
      const res = await fetch('/api/admin/manual-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({
          registrationId: pendingManual.registrationId,
          ...(manualNote.trim() ? { note: manualNote.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to mark as paid');
      }
      setPendingManual(null);
      setManualNote('');
      // Refresh rather than patch locally — the server owns the attribution
      // (who/when) shown in the badge tooltip.
      await refresh();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Failed to mark as paid');
    } finally {
      setManualBusyId(null);
    }
  };

  const handleUnmarkPaid = useCallback(async (row: RegistrationRow) => {
    setManualBusyId(row.registrationId);
    setLevelError('');
    try {
      const res = await fetch(
        `/api/admin/manual-payment?registrationId=${encodeURIComponent(row.registrationId)}`,
        { method: 'DELETE', headers: { 'X-Club-Slug': clubSlug } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to remove the manual override');
      }
      await refresh();
    } catch (e) {
      setLevelError(e instanceof Error ? e.message : 'Failed to remove the manual override');
    } finally {
      setManualBusyId(null);
    }
  }, [clubSlug, refresh]);

  const handleImported = () => {
    closeImport();
    refresh();
  };

  const filteredClub = useMemo(
    () => (club ? applyClubFilters(club, filters) : null),
    [club, filters],
  );

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(
        `/api/my-registrations?registrationId=${encodeURIComponent(pendingDelete.registrationId)}`,
        {
          method: 'DELETE',
          headers: { 'X-Club-Slug': clubSlug },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Delete failed');
      }
      const id = pendingDelete.registrationId;
      setPersonal(rows => rows.filter(r => r.registrationId !== id));
      setClub(rows => rows ? rows.filter(r => r.registrationId !== id) : rows);
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError('');
  };

  const personalContent = personal.length === 0
    ? <EmptyState isAdmin={isAdmin} scope="personal" />
    : <RegistrationsTable
        rows={personal}
        sixthHeader="Relationship"
        canDelete={false}
      />;

  const clubContent = club && (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <ClubFilterBar rows={club} filters={filters} onChange={setFilters} />
        <Group gap="xs" wrap="wrap">
          <Button
            leftSection={<IconFileUpload size={16} />}
            onClick={openImport}
            radius="xl"
            variant="light"
            size="xs"
          >
            Import Players
          </Button>
          <Button
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={() => exportRegistrationsToXlsx(filteredClub ?? club, clubSlug, filters)}
            radius="xl"
            variant="light"
            size="xs"
            disabled={(filteredClub ?? club).length === 0}
          >
            Export to Excel
          </Button>
        </Group>
      </Group>
      {levelError && <Alert color="red" variant="light">{levelError}</Alert>}
      {club.length === 0 ? (
        <EmptyState isAdmin={isAdmin} scope="club" />
      ) : filteredClub && filteredClub.length === 0 ? (
        <Text size="sm" c="dimmed">No registrations match the current filters.</Text>
      ) : (
        <RegistrationsTable
          rows={filteredClub ?? club}
          sixthHeader="Linked accounts"
          canDelete
          onDelete={setPendingDelete}
          editableLevels={{
            levels,
            updatingId: updatingLevelId,
            onChange: handleLevelChange,
          }}
          manualPayment={{
            busyId: manualBusyId,
            onMark: openManualModal,
            onUnmark: handleUnmarkPaid,
          }}
        />
      )}
    </Stack>
  );

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <PageHeader
        title="Registrations"
        subtitle={isAdmin
          ? 'Your linked registrations, plus all registrations across the club.'
          : 'Player registrations linked to your account.'}
      />

      {error && <Alert color="red" variant="light">{error}</Alert>}

      {loading ? (
        <Center h={160}><Loader /></Center>
      ) : isAdmin ? (
        <Tabs defaultValue="mine" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="mine">My Registrations</Tabs.Tab>
            <Tabs.Tab value="club">Club Registrations</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="mine" pt="lg">{personalContent}</Tabs.Panel>
          <Tabs.Panel value="club" pt="lg">{clubContent}</Tabs.Panel>
        </Tabs>
      ) : (
        personalContent
      )}

      <Modal
        opened={importOpened}
        onClose={closeImport}
        title="Import Players"
        size="xl"
        radius="md"
      >
        <ImportPlayersPanel onImported={handleImported} />
      </Modal>

      <Modal
        opened={pendingManual !== null}
        onClose={closeManualModal}
        title="Mark as paid"
        size="sm"
        centered
      >
        {pendingManual && (
          <Stack>
            {manualError && <Alert color="red" variant="light">{manualError}</Alert>}
            <Text size="sm">
              Mark <strong>{pendingManual.fanId}</strong> ({pendingManual.teamName}) as
              paid up for subs? They will show as <strong>Paid</strong> and will not be
              asked to set up a Direct Debit.
            </Text>
            <Textarea
              label="Note (optional)"
              placeholder="e.g. cash at training 12 Aug, bank transfer ref 4471"
              value={manualNote}
              onChange={e => setManualNote(e.currentTarget.value)}
              rows={3}
              radius="md"
            />
            <Text size="xs" c="dimmed">
              Your name and the time are recorded against this override for audit.
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                radius="xl"
                onClick={closeManualModal}
                disabled={manualBusyId !== null}
              >
                Cancel
              </Button>
              <Button
                color="green"
                radius="xl"
                onClick={handleConfirmMarkPaid}
                loading={manualBusyId !== null}
              >
                Mark as paid
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={pendingDelete !== null}
        onClose={closeDeleteModal}
        title="Remove registration"
        size="sm"
        centered
      >
        {pendingDelete && (
          <Stack>
            {deleteError && <Alert color="red" variant="light">{deleteError}</Alert>}
            <Text size="sm">
              Remove <strong>{pendingDelete.fanId}</strong> from{' '}
              <strong>{pendingDelete.teamName}</strong>? This deletes the registration
              and any linked payment records and cannot be undone.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" radius="xl" onClick={closeDeleteModal} disabled={deleting}>
                Cancel
              </Button>
              <Button color="red" radius="xl" onClick={handleConfirmDelete} loading={deleting}>
                Remove
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
