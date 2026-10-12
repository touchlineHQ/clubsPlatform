import { useEffect, useMemo, useState } from 'react';
import { Alert, Center, Group, Loader, NativeSelect, Stack, Table, Text } from '@mantine/core';
import { captureError } from '../../lib/posthog';
import { breakdownByTeam, type TeamBreakdown } from '../../utils/teamBreakdown';
import { ExportTooLargeError, useAllClubRegistrations } from './useAllClubRegistrations';
import { ALL } from './types';

type SortKey = 'teamName' | 'outstanding' | 'league' | 'training' | 'issues';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'teamName', label: 'Team name' },
  { value: 'outstanding', label: 'Most outstanding' },
  { value: 'issues', label: 'Most issues' },
  { value: 'league', label: 'Fewest league players' },
  { value: 'training', label: 'Fewest training players' },
];

function sortTeams(teams: TeamBreakdown[], key: SortKey): TeamBreakdown[] {
  const copy = [...teams];
  switch (key) {
    case 'outstanding': return copy.sort((a, b) => b.outstanding - a.outstanding);
    case 'issues': return copy.sort((a, b) => b.issues - a.issues);
    case 'league': return copy.sort((a, b) => a.league - b.league);
    case 'training': return copy.sort((a, b) => a.training - b.training);
    default: return copy; // already by name
  }
}

const COLUMNS: { key: keyof TeamBreakdown; label: string }[] = [
  { key: 'league', label: 'League' },
  { key: 'training', label: 'Training' },
  { key: 'players', label: 'Players' },
  { key: 'paying', label: 'Paying' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'issues', label: 'Issues' },
];

/**
 * Names of the club's configured teams, so ones with no registrations still
 * show. Non-fatal: without them the breakdown just covers registered teams.
 */
async function loadConfiguredTeams(clubSlug: string): Promise<string[]> {
  try {
    const res = await fetch('/api/teams', { headers: { 'X-Club-Slug': clubSlug } });
    if (!res.ok) return [];
    const data = await res.json() as { teams?: { name?: unknown }[] };
    return (data.teams ?? []).map(t => (typeof t.name === 'string' ? t.name : '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * One row per team (#230): league / training counts, money and issues, so an
 * official can see who to chase and where there is space. Aggregated
 * client-side from the full club set, via the same paginated loader the export
 * uses, so no new endpoint and no extra D1 reads per request.
 */
export function TeamBreakdownTab({ clubSlug, reloadToken }: { clubSlug: string; reloadToken: number }) {
  const { loadAll, progress } = useAllClubRegistrations(clubSlug);
  const [teams, setTeams] = useState<TeamBreakdown[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('teamName');

  useEffect(() => {
    let cancelled = false;
    setTeams(null);
    setError('');
    Promise.all([
      loadAll({ team: ALL, status: ALL, subscription: ALL }, ''),
      loadConfiguredTeams(clubSlug),
    ])
      .then(([rows, configured]) => {
        if (!cancelled) setTeams(breakdownByTeam(rows, Date.now(), configured));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        captureError(e, { op: 'registrations.team-breakdown' });
        setError(e instanceof ExportTooLargeError
          ? 'This club has too many registrations to break down here.'
          : 'Failed to load team breakdown');
      });
    return () => { cancelled = true; };
  }, [loadAll, clubSlug, reloadToken]);

  const sorted = useMemo(() => (teams ? sortTeams(teams, sort) : []), [teams, sort]);

  if (error) return <Alert color="red" variant="light">{error}</Alert>;
  if (!teams) {
    return (
      <Center h={160}>
        <Stack align="center" gap="xs">
          <Loader />
          {progress > 0 && <Text size="xs" c="dimmed">Loaded {progress} registrations…</Text>}
        </Stack>
      </Center>
    );
  }
  if (teams.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">No teams or registrations yet, so there is nothing to break down.</Text>;
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <Text size="xs" c="dimmed" maw={560}>
          League = league-registered players (FA status Active or equivalent). Training = Training Only.
          Players = league + training (distinct). Paying and Outstanding count billing units.
          Issues = no level assigned or registration expired.
        </Text>
        <NativeSelect
          label="Sort by"
          size="xs"
          w={200}
          data={SORT_OPTIONS}
          value={sort}
          onChange={e => setSort(e.currentTarget.value as SortKey)}
        />
      </Group>
      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover aria-label="Team breakdown">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Team</Table.Th>
              {COLUMNS.map(c => <Table.Th key={c.key} ta="right">{c.label}</Table.Th>)}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.map(t => (
              <Table.Tr key={t.teamName}>
                <Table.Td fw={600}>{t.teamName}</Table.Td>
                {COLUMNS.map(c => (
                  <Table.Td
                    key={c.key}
                    ta="right"
                    c={(c.key === 'outstanding' || c.key === 'issues') && Number(t[c.key]) > 0 ? 'orange' : undefined}
                  >
                    {t[c.key]}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
