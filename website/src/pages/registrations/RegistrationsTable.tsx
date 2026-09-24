import { useMemo, useState } from 'react';
import {
  Table, Stack, Badge, Text, Paper, Box, Group, Button, UnstyledButton, Select,
  ActionIcon, Tooltip, Checkbox,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconChevronDown, IconChevronUp, IconSelector, IconTrash, IconUserCheck, IconArrowsJoin,
} from '@tabler/icons-react';
import { getSubscriptionStatus } from '../../utils/subscriptionStatus';
import {
  DEFAULT_VALUE,
  compareValues,
  type RegistrationRow,
  type SortKey,
  type SortState,
  type SubscriptionLevel,
} from './types';

/**
 * Client-side sorting, for the personal tab only.
 *
 * The club tab sorts in SQL, because it only ever holds one page and sorting
 * that would order the page rather than the club.
 */
function sortRows(rows: RegistrationRow[], sort: SortState): RegistrationRow[] {
  const keyValue = (r: RegistrationRow): string => {
    switch (sort.key) {
      case 'fanId': return r.fanId;
      case 'teamName': return r.teamName;
      case 'registrationExpiry': return r.registrationExpiry ?? '';
      case 'registrationStatus': return r.registrationStatus ?? '';
      case 'subscription': return getSubscriptionStatus(r).label;
      case 'subscriptionLevel': return r.subscriptionLevelName ?? '';
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

export interface TableProps {
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

  /**
   * Present when the caller sorts in SQL. The header then reports intent
   * instead of reordering what it happens to hold.
   */
  serverSort?: {
    sort: SortState;
    onSort: (next: SortState) => void;
  };
}

export function RegistrationsTable({
  rows, sixthHeader, canDelete, onDelete, editableLevels, manualPayment, merge, serverSort,
}: TableProps) {
  // Uncontrolled for the personal tab, controlled by the club tab's hook when
  // sorting happens in SQL. One component either way so the two cannot drift.
  const [localSort, setLocalSort] = useState<SortState>({ key: 'teamName', dir: 'asc' });
  const sort = serverSort?.sort ?? localSort;
  const sixthIsLinkedAccounts = sixthHeader === 'Linked accounts';
  const isMobile = useMediaQuery('(max-width: 768px)');

  const sortedRows = useMemo(
    () => (serverSort ? rows : sortRows(rows, sort)),
    [rows, sort, serverSort],
  );

  const handleSort = (key: SortKey) => {
    const next: SortState = sort.key === key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
    if (serverSort) serverSort.onSort(next);
    else setLocalSort(next);
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
            <Table.Th>{sixthHeader}</Table.Th>
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
