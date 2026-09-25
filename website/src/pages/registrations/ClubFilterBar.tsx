import { useMemo } from 'react';
import { Button, Group, Select, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { ALL, type ClubFilters } from './types';

interface ClubFilterBarProps {
  /** Every team and status in the club, from /api/admin/registration-facets. */
  facets: { teams: string[]; statuses: string[] };
  filters: ClubFilters;
  onChange: (next: ClubFilters) => void;
  /** Prefix search over FAN ID and team name, applied server-side. */
  search: string;
  onSearch: (next: string) => void;
}

export function ClubFilterBar({ facets, filters, onChange, search, onSearch }: ClubFilterBarProps) {
  // From the club, not from the loaded rows: derived from a page they would
  // shrink as you filter or move between pages.
  const teamOptions = useMemo(
    () => [{ value: ALL, label: 'All teams' }, ...facets.teams.map(t => ({ value: t, label: t }))],
    [facets.teams],
  );

  const statusOptions = useMemo(
    () => [{ value: ALL, label: 'All statuses' }, ...facets.statuses.map(s => ({ value: s, label: s }))],
    [facets.statuses],
  );

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
      <TextInput
        size="xs"
        w={220}
        value={search}
        onChange={e => onSearch(e.currentTarget.value)}
        placeholder="Search FAN ID or team"
        aria-label="Search registrations"
        leftSection={<IconSearch size={14} />}
      />
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
      {(filters.team !== ALL || filters.status !== ALL || filters.subscription !== ALL || search !== '') && (
        <Button
          size="xs"
          variant="subtle"
          onClick={() => { onChange({ team: ALL, status: ALL, subscription: ALL }); onSearch(''); }}
        >
          Clear
        </Button>
      )}
    </Group>
  );
}
