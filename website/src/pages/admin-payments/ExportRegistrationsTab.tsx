import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Box, Button, Center, Group, Loader, Paper, ScrollArea,
  Select, Stack, Table, Text,
} from '@mantine/core';
import { IconAlertCircle, IconFileSpreadsheet } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import { useClub } from '../../context/ClubContext';
import { clubDesign } from '../../theme';
import { formatGBP, type PlayerRegistrationRow } from './types';

const ALL = '__all__';

interface Filters {
  team: string;
  status: string;
  ageGroup: string;
}

interface Props {
  clubHeaders: HeadersInit;
}

function buildPaymentLink(origin: string, clubSlug: string, fanId: string): string {
  return `${origin}/${clubSlug}/payments/SUBS/${encodeURIComponent(fanId)}`;
}

function formatExpiry(value: string | null): string {
  if (!value) return '';
  // Stored as ISO/D1 date string — surface as-is, since values come from the
  // FA import and the admin already recognises them in that form.
  return value;
}

function formatInterval(reg: PlayerRegistrationRow): string {
  if (!reg.intervalCount || !reg.intervalUnit) return '';
  return `${reg.intervalCount} × ${reg.intervalUnit}`;
}

function formatAmountPerPeriod(reg: PlayerRegistrationRow): string {
  if (reg.yearlyPriceInPence == null || !reg.intervalCount) return '';
  const perPence = Math.round(reg.yearlyPriceInPence / Math.max(1, reg.intervalCount));
  return formatGBP(perPence);
}

export function ExportRegistrationsTab({ clubHeaders }: Props) {
  const { clubSlug } = useClub();
  const [registrations, setRegistrations] = useState<PlayerRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState<Filters>({ team: ALL, status: ALL, ageGroup: ALL });

  useEffect(() => {
    fetch('/api/admin/player-registrations', { headers: clubHeaders })
      .then(r => r.ok ? r.json() as Promise<{ registrations: PlayerRegistrationRow[] }> : Promise.reject())
      .then(d => setRegistrations(d.registrations))
      .catch(() => setLoadError('Failed to load registrations.'))
      .finally(() => setLoading(false));
  }, []);

  const teamOptions = useMemo(() => {
    const teams = Array.from(new Set(registrations.map(r => r.teamName).filter(Boolean))).sort();
    return [{ value: ALL, label: 'All teams' }, ...teams.map(t => ({ value: t, label: t }))];
  }, [registrations]);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(registrations.map(r => r.registrationStatus).filter(Boolean) as string[])).sort();
    return [{ value: ALL, label: 'All statuses' }, ...statuses.map(s => ({ value: s, label: s }))];
  }, [registrations]);

  const ageGroupOptions = useMemo(() => {
    const ages = Array.from(new Set(registrations.map(r => r.ageGroup).filter(Boolean) as string[])).sort();
    return [{ value: ALL, label: 'All age groups' }, ...ages.map(a => ({ value: a, label: a }))];
  }, [registrations]);

  const filtered = useMemo(() => registrations.filter(r => {
    if (filters.team     !== ALL && r.teamName            !== filters.team)     return false;
    if (filters.status   !== ALL && r.registrationStatus  !== filters.status)   return false;
    if (filters.ageGroup !== ALL && r.ageGroup            !== filters.ageGroup) return false;
    return true;
  }), [registrations, filters]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const handleExport = () => {
    const rows = filtered.map(r => ({
      'FAN ID':            r.fanId,
      'Team':              r.teamName,
      'Age Group':         r.ageGroup ?? '',
      'Status':            r.registrationStatus ?? '',
      'Expiry':            formatExpiry(r.registrationExpiry),
      'Linked Accounts':   r.linkedAccounts ?? '',
      'Subscription Level': r.subscriptionLevelName ?? '',
      'Amount per Period': formatAmountPerPeriod(r),
      'Schedule':          formatInterval(r),
      'Payment Link':      buildPaymentLink(origin, clubSlug, r.fanId),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Approximate column widths so the spreadsheet opens with reasonable spacing.
    ws['!cols'] = [
      { wch: 12 }, // FAN ID
      { wch: 22 }, // Team
      { wch: 10 }, // Age Group
      { wch: 14 }, // Status
      { wch: 12 }, // Expiry
      { wch: 38 }, // Linked Accounts
      { wch: 22 }, // Subscription Level
      { wch: 14 }, // Amount per Period
      { wch: 14 }, // Schedule
      { wch: 60 }, // Payment Link
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Registrations');

    const today = new Date().toISOString().slice(0, 10);
    const filterSuffix = [
      filters.team     !== ALL ? filters.team     : null,
      filters.status   !== ALL ? filters.status   : null,
      filters.ageGroup !== ALL ? filters.ageGroup : null,
    ].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]+/g, '_');

    const fileSlug = clubSlug || 'club';
    const filename = filterSuffix
      ? `${fileSlug}-registrations-${filterSuffix}-${today}.xlsx`
      : `${fileSlug}-registrations-${today}.xlsx`;

    XLSX.writeFile(wb, filename);
  };

  if (loading) {
    return <Center h={120}><Loader size="sm" /></Center>;
  }

  if (loadError) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
        {loadError}
      </Alert>
    );
  }

  const anyFilterActive = filters.team !== ALL || filters.status !== ALL || filters.ageGroup !== ALL;

  const filterBar = (
    <Group gap="sm" wrap="wrap">
      <Select
        size="xs"
        w={200}
        value={filters.team}
        onChange={v => setFilters(f => ({ ...f, team: v ?? ALL }))}
        data={teamOptions}
        searchable
        aria-label="Filter by team"
      />
      <Select
        size="xs"
        w={180}
        value={filters.status}
        onChange={v => setFilters(f => ({ ...f, status: v ?? ALL }))}
        data={statusOptions}
        aria-label="Filter by registration status"
      />
      <Select
        size="xs"
        w={160}
        value={filters.ageGroup}
        onChange={v => setFilters(f => ({ ...f, ageGroup: v ?? ALL }))}
        data={ageGroupOptions}
        aria-label="Filter by age group"
      />
      {anyFilterActive && (
        <Button size="xs" variant="subtle" onClick={() => setFilters({ team: ALL, status: ALL, ageGroup: ALL })}>
          Clear
        </Button>
      )}
    </Group>
  );

  if (registrations.length === 0) {
    return (
      <Stack gap="md">
        <Box
          p="xl"
          style={{
            background: clubDesign.color.n1,
            border: `1px dashed ${clubDesign.color.n3}`,
            borderRadius: clubDesign.radius.card,
            textAlign: 'center',
          }}
        >
          <Text size="sm" c="dimmed">
            No registrations to export yet. Import players via Manage Users → Import.
          </Text>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Alert color="blue" variant="light" radius="md">
        <Text size="sm">
          Export the filtered list below to Excel. Each row includes a public payment link
          using the player's FAN — the link works once a subscription level is assigned to
          their team.
        </Text>
      </Alert>

      <Group justify="space-between" wrap="wrap" gap="sm">
        {filterBar}
        <Group gap="xs" wrap="nowrap">
          <Badge color="blue" variant="light" radius="xl">
            {filtered.length} of {registrations.length}
          </Badge>
          <Button
            radius="xl"
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            Export to Excel
          </Button>
        </Group>
      </Group>

      {filtered.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">No registrations match your filters.</Text>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <ScrollArea.Autosize mah={500}>
            <Table striped highlightOnHover fz="xs" miw={900}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>FAN ID</Table.Th>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Age</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Expiry</Table.Th>
                  <Table.Th>Subscription</Table.Th>
                  <Table.Th>Payment Link</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map(r => {
                  const link = buildPaymentLink(origin, clubSlug, r.fanId);
                  return (
                    <Table.Tr key={r.registrationId}>
                      <Table.Td><Text size="xs" ff="monospace" fw={600}>{r.fanId}</Text></Table.Td>
                      <Table.Td><Text size="xs">{r.teamName}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{r.ageGroup ?? ''}</Text></Table.Td>
                      <Table.Td><Text size="xs">{r.registrationStatus ?? ''}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{formatExpiry(r.registrationExpiry)}</Text></Table.Td>
                      <Table.Td>
                        {r.subscriptionLevelName ? (
                          <Text size="xs">
                            {r.subscriptionLevelName}
                            {formatAmountPerPeriod(r) && (
                              <Text component="span" size="xs" c="dimmed"> — {formatAmountPerPeriod(r)} / {r.intervalUnit}</Text>
                            )}
                          </Text>
                        ) : (
                          <Text size="xs" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace" c="dimmed" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {link}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Paper>
      )}
    </Stack>
  );
}
