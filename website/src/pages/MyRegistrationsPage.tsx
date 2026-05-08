import { useEffect, useMemo, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text, Paper, Box, Group, Button, UnstyledButton, Title,
  Select, ActionIcon, Modal, Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconArrowRight, IconChevronDown, IconChevronUp, IconSelector, IconTrash,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

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
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
}

interface Response {
  personal: RegistrationRow[];
  club: RegistrationRow[] | null;
  scope: 'admin' | 'user';
}

type SortKey = 'fanId' | 'teamName' | 'ageGroup' | 'registrationExpiry' | 'registrationStatus' | 'subscription' | 'sixthCol';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

type SubStatus = 'paid' | 'setup' | 'outstanding' | 'cancelled' | 'none';

interface SubStatusInfo {
  status: SubStatus;
  label: string;
  color: string;
}

function getSubscriptionStatus(row: RegistrationRow): SubStatusInfo {
  if (!row.subscriptionLevelId) {
    return { status: 'none', label: 'No level', color: 'gray' };
  }
  switch (row.paymentStatus) {
    case 'active':
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
      case 'ageGroup': return r.ageGroup ?? '';
      case 'registrationExpiry': return r.registrationExpiry ?? '';
      case 'registrationStatus': return r.registrationStatus ?? '';
      case 'subscription': return getSubscriptionStatus(r).label;
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

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <Text size="sm">—</Text>;
  return (
    <Badge
      size="sm"
      variant="light"
      color={value.toLowerCase().includes('registered') ? 'green' : 'orange'}
      radius="xl"
    >
      {value}
    </Badge>
  );
}

function SubscriptionBadge({ row }: { row: RegistrationRow }) {
  const info = getSubscriptionStatus(row);
  const label = row.subscriptionLevelName
    ? `${info.label} · ${row.subscriptionLevelName}`
    : info.label;
  return (
    <Badge size="sm" variant="light" color={info.color} radius="xl">
      {label}
    </Badge>
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
          >
            {email}
          </Badge>
        );
      })}
    </Group>
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
    >
      {value}
    </Badge>
  );
}

interface TableProps {
  rows: RegistrationRow[];
  sixthHeader: 'Linked accounts' | 'Relationship';
  canDelete: boolean;
  onDelete?: (row: RegistrationRow) => void;
}

function RegistrationsTable({ rows, sixthHeader, canDelete, onDelete }: TableProps) {
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
                <SubscriptionBadge row={r} />
              </Group>
              <Group gap="md" wrap="wrap">
                <Text size="xs" c="dimmed"><b>Age:</b> {r.ageGroup || '—'}</Text>
                <Text size="xs" c="dimmed"><b>Expiry:</b> {r.registrationExpiry || '—'}</Text>
              </Group>
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

  return (
    <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
      <Table striped highlightOnHover fz="sm" miw={canDelete ? 880 : 820}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th><SortHeader label="FAN ID" sortKey="fanId" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Team" sortKey="teamName" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Age" sortKey="ageGroup" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Expiry" sortKey="registrationExpiry" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Status" sortKey="registrationStatus" {...headerProps} /></Table.Th>
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
              <Table.Td><Text size="sm">{r.ageGroup || '—'}</Text></Table.Td>
              <Table.Td><Text size="sm">{r.registrationExpiry || '—'}</Text></Table.Td>
              <Table.Td><StatusBadge value={r.registrationStatus} /></Table.Td>
              <Table.Td><SubscriptionBadge row={r} /></Table.Td>
              <Table.Td>
                {sixthIsLinkedAccounts
                  ? <LinkedAccountsCell row={r} />
                  : <RelationshipBadge value={r.relationship} />}
              </Table.Td>
              {canDelete && onDelete && (
                <Table.Td style={{ width: 1 }}>
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
    { value: 'none', label: 'No level' },
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

export function MyRegistrationsPage() {
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/my-registrations', {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) throw new Error('Failed to load registrations');
        const data = await res.json() as Response;
        if (cancelled) return;
        setPersonal(data.personal);
        setClub(data.club);
        setScope(data.scope);
      } catch {
        if (!cancelled) setError('Failed to load registrations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubSlug]);

  const isAdmin = scope === 'admin';

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

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <PageHeader
        title={isAdmin ? 'Registrations' : 'My Registrations'}
        subtitle={isAdmin
          ? 'Your linked registrations, plus all registrations across the club.'
          : 'Player registrations linked to your account.'}
      />

      {error && <Alert color="red" variant="light">{error}</Alert>}

      {loading ? (
        <Center h={160}><Loader /></Center>
      ) : (
        <>
          <Stack gap="sm">
            {isAdmin && (
              <Title order={4} ff={clubDesign.font.heading}>My Registrations</Title>
            )}
            {personal.length === 0
              ? <EmptyState isAdmin={isAdmin} scope="personal" />
              : <RegistrationsTable
                  rows={personal}
                  sixthHeader="Relationship"
                  canDelete={isAdmin}
                  onDelete={setPendingDelete}
                />
            }
          </Stack>

          {isAdmin && club && (
            <Stack gap="sm">
              <Title order={4} ff={clubDesign.font.heading}>Club Registrations</Title>
              {club.length === 0 ? (
                <EmptyState isAdmin={isAdmin} scope="club" />
              ) : (
                <>
                  <ClubFilterBar rows={club} filters={filters} onChange={setFilters} />
                  {filteredClub && filteredClub.length === 0 ? (
                    <Text size="sm" c="dimmed">No registrations match the current filters.</Text>
                  ) : (
                    <RegistrationsTable
                      rows={filteredClub ?? club}
                      sixthHeader="Linked accounts"
                      canDelete
                      onDelete={setPendingDelete}
                    />
                  )}
                </>
              )}
            </Stack>
          )}
        </>
      )}

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
