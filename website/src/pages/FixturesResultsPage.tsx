import { useState, useMemo } from 'react';
import {
  Title, Text, Stack, Paper, Badge, Group, Select, Tabs,
  Table, Alert,
} from '@mantine/core';
import { IconCalendar, IconTrophy, IconAlertCircle } from '@tabler/icons-react';
import type { ClubFeed, LiveResult, LiveFixture, TeamsData, LiveTeam } from '../types';
import { useSection } from '../context/SectionContext';
import { findDuplicateTeamNames, teamDisplayLabel, liveTeamsForSection } from '../utils/teamMatching';

const FORM_GAMES = 5;

function getOutcome(r: LiveResult): 'W' | 'D' | 'L' | null {
  if (r.goals_for === null || r.goals_against === null) return null;
  if (r.goals_for > r.goals_against) return 'W';
  if (r.goals_for === r.goals_against) return 'D';
  return 'L';
}

const outcomeColor: Record<'W' | 'D' | 'L', string> = { W: 'green', D: 'yellow', L: 'red' };

function ResultsStats({ results }: { results: LiveResult[] }) {
  const outcomes = results.map(getOutcome).filter((o): o is 'W' | 'D' | 'L' => o !== null);
  if (outcomes.length === 0) return null;

  const w = outcomes.filter((o) => o === 'W').length;
  const d = outcomes.filter((o) => o === 'D').length;
  const l = outcomes.filter((o) => o === 'L').length;
  const form = outcomes.slice(0, FORM_GAMES);

  return (
    <Paper p="sm" withBorder radius="md">
      <Group gap="lg" wrap="wrap">
        <Group gap="xs">
          <Text size="xs" c="dimmed" fw={500}>P</Text>
          <Text size="sm" fw={700}>{outcomes.length}</Text>
          <Text size="xs" c="green" fw={500} ml={4}>W</Text>
          <Text size="sm" fw={700} c="green">{w}</Text>
          <Text size="xs" c="yellow.7" fw={500} ml={4}>D</Text>
          <Text size="sm" fw={700} c="yellow.7">{d}</Text>
          <Text size="xs" c="red" fw={500} ml={4}>L</Text>
          <Text size="sm" fw={700} c="red">{l}</Text>
        </Group>
        <Group gap={4} align="center">
          <Text size="xs" c="dimmed">Form</Text>
          {form.map((o, i) => (
            <Badge key={i} color={outcomeColor[o]} variant="filled" size="xs" radius="sm">{o}</Badge>
          ))}
        </Group>
      </Group>
    </Paper>
  );
}

interface Props {
  feed: ClubFeed | null;
  teams: TeamsData;
  liveTeams: LiveTeam[];
}


function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function FixturesResultsPage({ feed, teams, liveTeams }: Props) {
  const { activeSection } = useSection();
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  // Use composite key (team + league) so same-named Saturday/Sunday teams stay separate
  const fixtureKey = (f: LiveFixture | LiveResult) => `${f.team}\0${f.league}`;

  // Get team names from the section by matching slugs OR age groups to liveTeams
  const allowedTeamNames = useMemo(() => {
    if (activeSection === 'all') return null;
    const section = teams.sections.find(s => s.id === activeSection);
    if (!section) return null;

    const matched = liveTeamsForSection(section, liveTeams);
    return new Set(matched.map(lt => lt.name));
  }, [activeSection, teams, liveTeams]);

  const duplicateNames = useMemo(() => findDuplicateTeamNames(liveTeams), [liveTeams]);

  const teamOptions = useMemo(() => {
    if (!feed) return [];
    const keys = new Set<string>();
    for (const f of feed.fixtures) if (f.team) keys.add(fixtureKey(f));
    for (const r of feed.results) if (r.team) keys.add(fixtureKey(r));

    // If section is filtered, only keep keys whose team name matches allowed team names
    const filtered = allowedTeamNames
      ? Array.from(keys).filter(k => {
          const [name] = k.split('\0');
          return allowedTeamNames.has(name);
        })
      : Array.from(keys);

    return filtered
      .map(k => {
        const [name, league] = k.split('\0');
        return { value: k, label: teamDisplayLabel(name, league, duplicateNames) };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [feed, allowedTeamNames, duplicateNames]);

  // Reset team dropdown when it's no longer in the available list
  const effectiveTeam = selectedTeam && teamOptions.some(o => o.value === selectedTeam) ? selectedTeam : null;

  // Filter by team name from liveTeams that match section teams
  const isAllowed = (f: LiveFixture | LiveResult) => {
    if (!allowedTeamNames) return true;
    return allowedTeamNames.has(f.team);
  };

  const fixtures = useMemo(() => {
    if (!feed) return [];
    let list = feed.fixtures.filter(isAllowed);
    if (effectiveTeam) {
      list = list.filter((f) => fixtureKey(f) === effectiveTeam);
    } else {
      const seen = new Set<string>();
      list = list.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
    }
    return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }, [feed, effectiveTeam, allowedTeamNames]);

  const results = useMemo(() => {
    if (!feed) return [];
    let list = feed.results.filter(isAllowed);
    if (effectiveTeam) {
      list = list.filter((r) => fixtureKey(r) === effectiveTeam);
    } else {
      const seen = new Set<string>();
      list = list.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }, [feed, effectiveTeam, allowedTeamNames]);

  if (!feed) {
    return (
      <Stack gap="md">
        <Title order={2}>Fixtures & Results</Title>
        <Alert icon={<IconAlertCircle size={16} />}>
          Live fixture and result data is currently unavailable. Please check back later.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>Fixtures & Results</Title>

      <Text size="sm" c="dimmed">
        Data sourced from FA Full-Time via{' '}
        <Text component="a" href="https://github.com/touchlineHQ/fulltimeFeeds" c="var(--mantine-primary-color-filled)" size="sm">
          fulltimeFeeds
        </Text>
        . Last updated: {new Date(feed.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
      </Text>

      <Select
        label="Filter by team"
        placeholder="All teams"
        data={teamOptions}
        value={effectiveTeam}
        onChange={(value) => setSelectedTeam(value)}
        clearable
        searchable
        allowDeselect={false}
      />

      <Tabs defaultValue="fixtures">
        <Tabs.List>
          <Tabs.Tab value="fixtures" leftSection={<IconCalendar size={14} />}>
            Fixtures ({fixtures.length})
          </Tabs.Tab>
          <Tabs.Tab value="results" leftSection={<IconTrophy size={14} />}>
            Results ({results.length})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="fixtures" pt="md">
          {fixtures.length === 0 ? (
            <Text c="dimmed" size="sm">No upcoming fixtures.</Text>
          ) : (
            <Stack gap="xs">
              {fixtures.map((f) => (
                <Paper key={f.id} p="sm" withBorder radius="md">
                  <Group justify="space-between" wrap="wrap" gap="xs" mb={4}>
                    <Badge variant="light" size="xs">{f.division}</Badge>
                    <Text size="xs" c="dimmed">{formatDate(f.date)} · {f.time}</Text>
                  </Group>
                  <Text fw={700} size="sm" ta="center">
                    {effectiveTeam ? `${f.team} vs ${f.opponent}` : `${f.home_team} vs ${f.away_team}`}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center">
                    {effectiveTeam ? `${f.home_away === 'home' ? 'Home' : 'Away'} · ${f.venue}` : f.venue}
                  </Text>
                </Paper>
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="results" pt="md">
          {results.length === 0 ? (
            <Text c="dimmed" size="sm">No results yet.</Text>
          ) : (
            <Stack gap="sm">
            {effectiveTeam && <ResultsStats results={results} />}
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Home</Table.Th>
                  <Table.Th ta="center">Score</Table.Th>
                  <Table.Th>Away</Table.Th>
                  <Table.Th visibleFrom="sm">Division</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {results.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Text size="xs">{formatDate(r.date)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={r.home_away === 'home' ? 700 : 400}>
                        {r.home_team}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" fw={700}>
                        {r.home_score ?? 'X'} - {r.away_score ?? 'X'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={r.home_away === 'away' ? 700 : 400}>
                        {r.away_team}
                      </Text>
                    </Table.Td>
                    <Table.Td visibleFrom="sm">
                      <Text size="xs" c="dimmed">{r.division}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}