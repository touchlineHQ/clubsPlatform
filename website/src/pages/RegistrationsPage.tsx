import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text, Paper, Box, Group, Button, UnstyledButton,
  Select, ActionIcon, Modal, Tooltip, Tabs, Textarea, Checkbox, Radio,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowRight, IconChevronDown, IconChevronUp, IconClipboardList, IconFileSpreadsheet, IconFileUpload,
  IconArrowsJoin, IconSelector, IconTrash, IconUserCheck,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { StatTileRow } from '../components/club/StatTile';
import { clubDesign } from '../theme';
import { ImportPlayersPanel } from './admin-users/ImportPlayersPanel';
import { StatusReportPanel } from './registrations/StatusReportPanel';
import { captureError, captureEvent } from '../lib/posthog';
import { timeAgo } from '../utils/timeAgo';
import { getSubscriptionStatus } from '../utils/subscriptionStatus';
import { buildPaymentLink } from '../utils/paymentLink';
import { summariseRegistrations } from '../utils/registrationSummary';
import { suggestMerges, suggestedRegistrationIds } from '../utils/mergeSuggestions';

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
  // Billing group — see functions/lib/registration-merge.ts. Sent only for rows
  // that are in a group, so a club that has merged nothing carries none of these.
  // A merged row shows its group's payment status; these say why.
  /** The registration this one is billed through. Absent means itself. */
  billingRegistrationId?: string;
  /** This registration's primary's team, when it is billed through another. */
  billedWithTeamName?: string | null;
  /** The other teams this registration is billed for, when it is a primary. */
  mergedTeamNames?: string | null;
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
  /** Epoch ms of the club's most recent committed player import; admins only. */
  lastImportedAt: number | null;
}

const DEFAULT_VALUE = '__default__';

/**
 * Mirrors MAX_MERGE_GROUP in api/admin/registration-merges.ts, so the admin is
 * told before meeting the 400. The server's cap is on the members *besides* the
 * primary, hence the +1 here.
 */
const MAX_MERGE_SELECTION = 26;

type SortKey = 'fanId' | 'teamName' | 'registrationExpiry' | 'registrationStatus' | 'subscription' | 'subscriptionLevel' | 'sixthCol';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
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

  // Say where the status came from, or the row reads "Paid in full" with no
  // payment behind it and someone chases a player who has already paid.
  const withBillingNote = row.billedWithTeamName
    ? (
      <Stack gap={2}>
        {badge}
        <Text size="xs" c="dimmed">Billed with {row.billedWithTeamName}</Text>
      </Stack>
    )
    : badge;

  if (!showManualMarker || row.paymentStatus !== 'manual') return withBillingNote;

  return (
    <Group gap={4} wrap="nowrap" align="center">
      {withBillingNote}
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

/** Marks a registration whose payment also covers other teams. */
function MergedTeamsBadge({ row }: { row: RegistrationRow }) {
  if (!row.mergedTeamNames) return null;
  const count = row.mergedTeamNames.split(',').length + 1;

  return (
    <Tooltip label={`One payment covering ${row.teamName}, ${row.mergedTeamNames}`} withArrow multiline w={260}>
      <Badge size="xs" variant="light" color="indigo" radius="xl" styles={BADGE_STYLES}>
        Billed for {count} teams
      </Badge>
    </Tooltip>
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
 * with a live GoCardless mandate ('pending'), a live subscription ('active') or
 * a plan already collected in full ('completed') can never be overridden —
 * deactivating a payment does not stop GoCardless collecting, and a finished
 * plan is paid already. Hiding the button keeps admins from meeting the 409.
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

  // Nothing to override for a player who is already paying or already paid —
  // api/admin/manual-payment.ts rejects all three with a 409.
  if (
    row.paymentStatus === 'active' ||
    row.paymentStatus === 'completed' ||
    row.paymentStatus === 'pending'
  ) return null;

  // The override belongs on the primary. The API resolves it either way; hiding
  // the button keeps the group's one payment record in one place.
  if (row.billedWithTeamName) return null;

  return (
    <Tooltip label="Record this player as paid outside GoCardless — cash, bank transfer, sponsored place" withArrow multiline w={240}>
      <Button size="xs" variant="subtle" color="green" loading={busy} onClick={() => onMark(row)}>
        Mark as paid
      </Button>
    </Tooltip>
  );
}

interface MergeProps {
  selectedIds: Set<string>;
  onToggle: (registrationId: string) => void;
  onUnmerge: (row: RegistrationRow) => void;
  busyId: string | null;
}

/** Offered on a primary only — a group is dissolved as a whole, not per member. */
function UnmergeAction({ row, onUnmerge, busyId }: MergeProps & { row: RegistrationRow }) {
  if (!row.mergedTeamNames) return null;

  return (
    <Tooltip label="Bill each of these registrations separately again" withArrow multiline w={240}>
      <Button
        size="xs"
        variant="subtle"
        color="indigo"
        loading={busyId === row.registrationId}
        onClick={() => onUnmerge(row)}
      >
        Unmerge
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
  /** Present only on the admin club tab; merging is an admin action. */
  merge?: MergeProps;
}

function RegistrationsTable({ rows, sixthHeader, canDelete, onDelete, editableLevels, manualPayment, merge }: TableProps) {
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
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  {merge && (
                    <Checkbox
                      size="xs"
                      mt={2}
                      checked={merge.selectedIds.has(r.registrationId)}
                      onChange={() => merge.onToggle(r.registrationId)}
                      aria-label={`Select ${r.teamName} for merging`}
                    />
                  )}
                  <Stack gap={2}>
                    <Text fw={700} size="sm">{r.teamName}</Text>
                    <Text size="xs" c="dimmed" ff="monospace">{r.fanId}</Text>
                  </Stack>
                </Group>
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
                <MergedTeamsBadge row={r} />
              </Group>
              <Group gap="xs" wrap="wrap">
                {manualPayment && <ManualPaymentAction row={r} {...manualPayment} />}
                {merge && <UnmergeAction row={r} {...merge} />}
              </Group>
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
    : (editableLevels ? 1000 : 820)) + (manualPayment ? 120 : 0) + (merge ? 140 : 0);

  return (
    <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
      <Table striped highlightOnHover fz="sm" miw={miw}>
        <Table.Thead>
          <Table.Tr>
            {merge && <Table.Th aria-label="Select for merging" style={{ width: 1 }} />}
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
              {merge && (
                <Table.Td style={{ width: 1 }}>
                  <Checkbox
                    size="xs"
                    checked={merge.selectedIds.has(r.registrationId)}
                    onChange={() => merge.onToggle(r.registrationId)}
                    aria-label={`Select ${r.teamName} for merging`}
                  />
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm" ff="monospace">{r.fanId}</Text>
              </Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm">{r.teamName}</Text>
                  <MergedTeamsBadge row={r} />
                </Group>
              </Table.Td>
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
                    {merge && <UnmergeAction row={r} {...merge} />}
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
    { value: 'paid', label: 'Paid in full' },
    { value: 'paying', label: 'Paying' },
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

/** Counts over the filtered rows; registrations and players differ for a multi-team player. */
function RegistrationsSummary({ rows }: { rows: RegistrationRow[] }) {
  const summary = useMemo(() => summariseRegistrations(rows), [rows]);

  return (
    <Box role="group" aria-label="Registrations summary">
      <StatTileRow
        cols={6}
        items={[
          { value: summary.registrations, label: 'Registrations' },
          { value: summary.players, label: 'Players' },
          // What the club charges for: a merged group counts once.
          { value: summary.billableUnits, label: 'Billable units' },
          { value: summary.paying, label: 'Paying' },
          { value: summary.outstanding, label: 'Outstanding' },
          { value: summary.noLevel, label: 'No level assigned' },
        ]}
      />
    </Box>
  );
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
    // Or a merged row exports as paid with nothing to explain why.
    'Billed Via':        r.billedWithTeamName
      ? `Billed with ${r.billedWithTeamName}`
      : r.mergedTeamNames ? `Also covers ${r.mergedTeamNames}` : '',
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
    { wch: 32 }, // Billed Via
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

/** Display personal or club registrations and the latest player-import time. */
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
  const [reportOpened, { open: openReport, close: closeReport }] = useDisclosure(false);
  const [levels, setLevels] = useState<SubscriptionLevel[]>([]);
  const [updatingLevelId, setUpdatingLevelId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState('');
  const [pendingManual, setPendingManual] = useState<RegistrationRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);
  const [manualError, setManualError] = useState('');
  const [unmarkPaidError, setUnmarkPaidError] = useState('');
  const [lastImportedAt, setLastImportedAt] = useState<number | null>(null);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergePrimaryId, setMergePrimaryId] = useState<string | null>(null);
  const [mergeBusyId, setMergeBusyId] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState('');
  const [showOnlySuggested, setShowOnlySuggested] = useState(false);

  /** Reload the registrations and import timestamp for the active club. */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/my-registrations', {
        headers: { 'X-Club-Slug': clubSlug },
      });
      if (!res.ok) throw new Error('Failed to load registrations');
      const data = await res.json() as Partial<Response>;
      // Defaulted, not trusted: the page reads `personal.length` directly, so a
      // missing field would white-screen the table rather than show an error.
      setPersonal(data.personal ?? []);
      setClub(data.club ?? null);
      setScope(data.scope ?? 'user');
      setLastImportedAt(data.lastImportedAt ?? null);
    } catch (e) {
      captureError(e, { op: 'registrations.refresh' });
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
    setUnmarkPaidError('');
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
      setUnmarkPaidError(e instanceof Error ? e.message : 'Failed to remove the manual override');
    } finally {
      setManualBusyId(null);
    }
  }, [clubSlug, refresh]);

  /** Close the import dialog and reload the newly imported registrations. */
  const handleImported = () => {
    closeImport();
    refresh();
  };

  // A hint only — same player and age group is wrong often enough that nothing
  // is stored until an admin decides.
  const suggestions = useMemo(() => suggestMerges(club ?? []), [club]);
  const suggestedIds = useMemo(() => suggestedRegistrationIds(suggestions), [suggestions]);
  const suggestedPlayerCount = useMemo(
    () => new Set(suggestions.map(suggestion => suggestion.fanId)).size,
    [suggestions],
  );

  useEffect(() => {
    if (suggestions.length === 0) setShowOnlySuggested(false);
  }, [suggestions.length]);

  const filteredClub = useMemo(() => {
    if (!club) return null;
    const rows = applyClubFilters(club, filters);
    return showOnlySuggested && suggestions.length > 0
      ? rows.filter(r => suggestedIds.has(r.registrationId))
      : rows;
  }, [club, filters, showOnlySuggested, suggestedIds, suggestions.length]);

  /** The selected rows, in the table's own order, for the primary picker. */
  const selectedRows = useMemo(
    () => (club ?? []).filter(r => selectedForMerge.has(r.registrationId)),
    [club, selectedForMerge],
  );

  /** Why the selection cannot merge, mirroring the API so the admin sees it before a 409. */
  const mergeBlocker = useMemo((): string | null => {
    if (selectedRows.length < 2) return 'Select two or more registrations to merge.';
    if (selectedRows.length > MAX_MERGE_SELECTION) {
      return `A billing group can hold at most ${MAX_MERGE_SELECTION} registrations.`;
    }
    if (new Set(selectedRows.map(r => r.fanId)).size > 1) {
      return 'Registrations can only be merged for one player at a time.';
    }
    const alreadyMerged = selectedRows.find(r => r.billedWithTeamName || r.mergedTeamNames);
    if (alreadyMerged) {
      return `${alreadyMerged.teamName} is already part of a billing group. Unmerge it first.`;
    }
    return null;
  }, [selectedRows]);

  const toggleMergeSelection = useCallback((registrationId: string) => {
    setMergeError('');
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(registrationId)) next.delete(registrationId);
      else next.add(registrationId);
      return next;
    });
  }, []);

  const openMergeModal = () => {
    // Level first, then paid, then whatever is first — the primary prices the
    // group, so one without a level would render a dead card.
    const preferred =
      selectedRows.find(r => r.subscriptionLevelId && r.paymentStatus)
      ?? selectedRows.find(r => r.subscriptionLevelId)
      ?? selectedRows[0];
    setMergePrimaryId(preferred?.registrationId ?? null);
    setMergeError('');
    setMergeModalOpen(true);
  };

  const handleConfirmMerge = async () => {
    if (!mergePrimaryId || selectedRows.length < 2) return;
    setMergeBusyId(mergePrimaryId);
    setMergeError('');
    try {
      const res = await fetch('/api/admin/registration-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({
          primaryRegistrationId: mergePrimaryId,
          registrationIds: selectedRows.map(r => r.registrationId),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to merge registrations');
      }
      captureEvent('registrations merged', {
        club_slug: clubSlug,
        group_size: selectedRows.length,
      });
      setMergeModalOpen(false);
      setSelectedForMerge(new Set());
      // Refresh, not patch: the server owns the grouping and the whole group's
      // payment status moves with it.
      await refresh();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Failed to merge registrations');
    } finally {
      setMergeBusyId(null);
    }
  };

  const handleUnmerge = async (row: RegistrationRow) => {
    setMergeBusyId(row.registrationId);
    setMergeError('');
    try {
      const res = await fetch(
        `/api/admin/registration-merges?primaryRegistrationId=${encodeURIComponent(row.registrationId)}`,
        { method: 'DELETE', headers: { 'X-Club-Slug': clubSlug } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to unmerge registrations');
      }
      captureEvent('registrations unmerged', { club_slug: clubSlug });
      await refresh();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Failed to unmerge registrations');
    } finally {
      setMergeBusyId(null);
    }
  };

  const filtersActive = filters.team !== ALL || filters.status !== ALL || filters.subscription !== ALL;

  /** The same filters, expressed for rows that exist only in the FA file. */
  const reportFaFilter = useMemo(() => ({
    team: filters.team !== ALL ? filters.team : null,
    registrationStatus: filters.status !== ALL ? filters.status : null,
    dropFaOnly: filters.subscription !== ALL,
  }), [filters]);

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
          {/* Never disabled: with no registrations the report is all "No subs record". */}
          <Button
            leftSection={<IconClipboardList size={16} />}
            onClick={openReport}
            radius="xl"
            variant="light"
            size="xs"
          >
            Generate status report
          </Button>
          <Button
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={() => {
              const rows = filteredClub ?? club;
              exportRegistrationsToXlsx(rows, clubSlug, filters);
              captureEvent('registrations exported', {
                club_slug: clubSlug,
                row_count: rows.length,
                filtered: rows.length !== club.length,
              });
            }}
            radius="xl"
            variant="light"
            size="xs"
            disabled={(filteredClub ?? club).length === 0}
          >
            Export to Excel
          </Button>
        </Group>
      </Group>
      {selectedForMerge.size > 0 && (
        <Group
          justify="space-between"
          wrap="wrap"
          gap="xs"
          p="xs"
          style={{
            background: 'var(--mantine-color-indigo-0)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Text size="sm">
            {selectedForMerge.size} selected
            {mergeBlocker && <Text span size="sm" c="dimmed"> — {mergeBlocker}</Text>}
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => setSelectedForMerge(new Set())}>
              Clear
            </Button>
            <Button
              size="xs"
              radius="xl"
              leftSection={<IconArrowsJoin size={16} />}
              disabled={mergeBlocker !== null}
              onClick={openMergeModal}
            >
              Merge registrations
            </Button>
          </Group>
        </Group>
      )}
      {suggestions.length > 0 && (
        <Alert color="indigo" variant="light" icon={<IconArrowsJoin size={18} />}>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm">
              {suggestedPlayerCount === 1
                ? '1 player has registrations in the same age group that are billed separately.'
                : `${suggestedPlayerCount} players have registrations in the same age group that are billed separately.`}
              {' '}
              <Text span size="sm" c="dimmed">
                They may be one set of subs — or genuinely separate. Only you can tell.
              </Text>
            </Text>
            <Button
              size="xs"
              variant={showOnlySuggested ? 'filled' : 'light'}
              radius="xl"
              onClick={() => setShowOnlySuggested(v => !v)}
            >
              {showOnlySuggested ? 'Show all' : 'Review them'}
            </Button>
          </Group>
        </Alert>
      )}
      {levelError && <Alert color="red" variant="light">{levelError}</Alert>}
      {unmarkPaidError && <Alert color="red" variant="light">{unmarkPaidError}</Alert>}
      {mergeError && <Alert color="red" variant="light">{mergeError}</Alert>}
      {/* Same rows as the Export button; zeroes when a filter matches nothing. */}
      {club.length > 0 && <RegistrationsSummary rows={filteredClub ?? club} />}
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
          merge={{
            selectedIds: selectedForMerge,
            onToggle: toggleMergeSelection,
            onUnmerge: handleUnmerge,
            busyId: mergeBusyId,
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
        below={isAdmin ? (
          <Box px={{ base: 'md', sm: 'xl' }} py="xs">
            <Text size="xs" c="dimmed">
              {lastImportedAt === null ? (
                'Player data has never been imported.'
              ) : (
                <Tooltip label={new Date(lastImportedAt).toLocaleString()} withArrow>
                  <span>Player data last imported {timeAgo(lastImportedAt)}</span>
                </Tooltip>
              )}
            </Text>
          </Box>
        ) : undefined}
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
        opened={reportOpened}
        onClose={closeReport}
        title="Generate status report"
        size="xl"
        radius="md"
      >
        <StatusReportPanel
          registrations={filteredClub ?? club ?? []}
          faFilter={reportFaFilter}
          clubSlug={clubSlug}
          filtersActive={filtersActive}
        />
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
              paid up for subs? They will show as <strong>Paid in full</strong> and will
              not be asked to set up a Direct Debit.
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
            {pendingDelete.mergedTeamNames && (
              <Alert color="orange" variant="light">
                This registration is what{' '}
                <strong>{pendingDelete.mergedTeamNames}</strong> {' '}
                {pendingDelete.mergedTeamNames.includes(',') ? 'are' : 'is'} billed
                through. Removing it takes the group&rsquo;s payment record with it and
                leaves them unpaid — unmerge first.
              </Alert>
            )}
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

      <Modal
        opened={mergeModalOpen}
        onClose={() => { if (!mergeBusyId) setMergeModalOpen(false); }}
        title="Merge registrations"
        size="md"
        centered
      >
        <Stack>
          {mergeError && <Alert color="red" variant="light">{mergeError}</Alert>}
          <Text size="sm">
            These registrations will be billed as one payment. Choose which one the
            payment hangs off — its subscription level prices the whole group, and its
            team name is what appears on the Direct Debit.
          </Text>
          <Radio.Group value={mergePrimaryId ?? ''} onChange={setMergePrimaryId}>
            <Stack gap="xs">
              {selectedRows.map(r => (
                <Radio
                  key={r.registrationId}
                  value={r.registrationId}
                  label={
                    <Box>
                      <Text size="sm" fw={600}>{r.teamName}</Text>
                      <Text size="xs" c={r.subscriptionLevelName ? 'dimmed' : 'orange'}>
                        {r.subscriptionLevelName ?? 'No subscription level assigned'}
                        {r.paymentStatus && ` · ${getSubscriptionStatus(r).label}`}
                      </Text>
                    </Box>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>
          <Text size="xs" c="dimmed">
            The other registrations keep their own level on record; it just stops being
            charged. You can unmerge at any time before a payment is set up.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              radius="xl"
              onClick={() => setMergeModalOpen(false)}
              disabled={mergeBusyId !== null}
            >
              Cancel
            </Button>
            <Button
              radius="xl"
              onClick={handleConfirmMerge}
              loading={mergeBusyId !== null}
              disabled={!mergePrimaryId}
            >
              Merge
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
