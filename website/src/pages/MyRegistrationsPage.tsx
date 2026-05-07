import { useEffect, useMemo, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text, Paper, Box, Group, Button, UnstyledButton, Title,
} from '@mantine/core';
import { IconArrowRight, IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
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
}

interface Response {
  personal: RegistrationRow[];
  club: RegistrationRow[] | null;
  scope: 'admin' | 'user';
}

type SortKey = 'fanId' | 'teamName' | 'ageGroup' | 'registrationExpiry' | 'registrationStatus' | 'sixthCol';
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
      case 'ageGroup': return r.ageGroup ?? '';
      case 'registrationExpiry': return r.registrationExpiry ?? '';
      case 'registrationStatus': return r.registrationStatus ?? '';
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

interface TableProps {
  rows: RegistrationRow[];
  sixthHeader: 'Linked accounts' | 'Relationship';
}

function RegistrationsTable({ rows, sixthHeader }: TableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'teamName', dir: 'asc' });
  const sixthIsLinkedAccounts = sixthHeader === 'Linked accounts';

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

  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <Table striped highlightOnHover fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th><SortHeader label="FAN ID" sortKey="fanId" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Team" sortKey="teamName" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Age" sortKey="ageGroup" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Expiry" sortKey="registrationExpiry" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label="Status" sortKey="registrationStatus" {...headerProps} /></Table.Th>
            <Table.Th><SortHeader label={sixthHeader} sortKey="sixthCol" {...headerProps} /></Table.Th>
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
              <Table.Td>
                {r.registrationStatus ? (
                  <Badge
                    size="sm"
                    variant="light"
                    color={r.registrationStatus.toLowerCase().includes('registered') ? 'green' : 'orange'}
                    radius="xl"
                  >
                    {r.registrationStatus}
                  </Badge>
                ) : '—'}
              </Table.Td>
              <Table.Td>
                {sixthIsLinkedAccounts ? (
                  <Group gap={4} wrap="wrap">
                    {r.linkedAccounts
                      ? r.linkedAccounts.split(',').map((pair, i) => {
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
                        })
                      : <Text size="xs" c="dimmed">—</Text>
                    }
                  </Group>
                ) : (
                  r.relationship ? (
                    <Badge
                      size="sm"
                      variant="light"
                      color={r.relationship === 'self' ? 'blue' : 'grape'}
                      radius="xl"
                      tt="capitalize"
                    >
                      {r.relationship}
                    </Badge>
                  ) : '—'
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
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
              : <RegistrationsTable rows={personal} sixthHeader="Relationship" />
            }
          </Stack>

          {isAdmin && club && (
            <Stack gap="sm">
              <Title order={4} ff={clubDesign.font.heading}>Club Registrations</Title>
              {club.length === 0
                ? <EmptyState isAdmin={isAdmin} scope="club" />
                : <RegistrationsTable rows={club} sixthHeader="Linked accounts" />
              }
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
