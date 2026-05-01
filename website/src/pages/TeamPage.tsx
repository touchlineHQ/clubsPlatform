import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Title, Text, Stack, Paper, Badge, Group, Tabs, Table, Box,
  Alert, Loader, Center, Button, Tooltip, CopyButton,
} from '@mantine/core';
import { IconCalendar, IconTrophy, IconAlertCircle, IconCopy, IconCheck, IconArrowLeft, IconUser } from '@tabler/icons-react';
import type { LiveTeam, TeamFeed, TeamContact } from '../types';
import { loadTeamFeed, teamCalendarUrl } from '../data';
import { useAuth } from '../context/AuthContext';
import { clubDesign } from '../theme';

const FORM_GAMES = 5;

type Outcome = 'W' | 'D' | 'L';
const outcomeColor: Record<Outcome, string> = { W: 'green', D: 'yellow', L: 'red' };

function getTeamOutcome(
  r: TeamFeed['results'][number],
  teamName: string,
): Outcome | null {
  if (r.home_score === null || r.away_score === null) return null;
  const isHome = r.home_team === teamName;
  const gf = isHome ? r.home_score : r.away_score;
  const ga = isHome ? r.away_score : r.home_score;
  if (gf > ga) return 'W';
  if (gf === ga) return 'D';
  return 'L';
}

function TeamResultsStats({ results, teamName }: { results: TeamFeed['results']; teamName: string }) {
  const outcomes = results
    .map((r) => getTeamOutcome(r, teamName))
    .filter((o): o is Outcome => o !== null);
  if (outcomes.length === 0) return null;

  const w = outcomes.filter((o) => o === 'W').length;
  const d = outcomes.filter((o) => o === 'D').length;
  const l = outcomes.filter((o) => o === 'L').length;
  const form = outcomes.slice(0, FORM_GAMES);

  return (
    <Paper p="md" withBorder radius="md">
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
        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.05em' }}>
            Form
          </Text>
          <Group gap={4} wrap="nowrap">
            {form.map((o, i) => (
              <Badge key={i} color={outcomeColor[o]} variant="filled" size="sm" radius="sm" fw={800}>
                {o}
              </Badge>
            ))}
          </Group>
        </Group>
      </Group>
    </Paper>
  );
}

interface Props {
  liveTeams: LiveTeam[];
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function TeamPage({ liveTeams }: Props) {
  const { teamSlug, league } = useParams<{ teamSlug: string; league?: string }>();
  const { user, teamRoles, refresh: refreshAuth } = useAuth();
  const [feed, setFeed] = useState<TeamFeed | null | undefined>(undefined);
  const [contacts, setContacts] = useState<TeamContact[]>([]);
  const [subscribing, setSubscribing] = useState(false);

  const teamMeta = league
    ? liveTeams.find((t) => t.slug === teamSlug && t.league === league)
    : liveTeams.find((t) => t.slug === teamSlug);

  useEffect(() => {
    if (!teamMeta) { setFeed(null); return; }
    setFeed(undefined);
    loadTeamFeed(teamMeta.league, teamMeta.slug).then(setFeed);
  }, [teamMeta]);

  useEffect(() => {
    if (!teamMeta) { setContacts([]); return; }
    const params = new URLSearchParams({ slug: teamMeta.slug, league: teamMeta.league });
    fetch(`/api/team-contacts?${params}`)
      .then(r => r.ok ? r.json() : { contacts: [] })
      .then((d: { contacts: TeamContact[] }) => setContacts(d.contacts))
      .catch(() => setContacts([]));
  }, [teamMeta]);

  const myRole = teamMeta
    ? teamRoles.find(r => r.teamSlug === teamMeta.slug && r.teamLeague === teamMeta.league)
    : undefined;

  const handleSubscribe = async () => {
    if (!teamMeta) return;
    setSubscribing(true);
    try {
      if (myRole?.role === 'subscriber') {
        const params = new URLSearchParams({ slug: teamMeta.slug, league: teamMeta.league });
        await fetch(`/api/team-subscriptions?${params}`, { method: 'DELETE' });
      } else {
        await fetch('/api/team-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamSlug: teamMeta.slug, teamLeague: teamMeta.league, teamName: teamMeta.name }),
        });
      }
      await refreshAuth();
    } finally {
      setSubscribing(false);
    }
  };

  if (!teamMeta) {
    return (
      <Stack gap="md">
        <Button component={Link} to="/teams" variant="subtle" leftSection={<IconArrowLeft size={14} />} w="fit-content" radius="xl">
          All Teams
        </Button>
        <Alert icon={<IconAlertCircle size={16} />}>Team not found.</Alert>
      </Stack>
    );
  }

  const calendarUrl = teamCalendarUrl(teamMeta.league, teamMeta.slug);

  return (
    <Stack gap="lg">
      {/* Header card with back button + title + actions */}
      <Paper radius="md" withBorder p="md">
        <Group gap="sm" wrap="wrap" align="center">
          <Button
            component={Link}
            to="/teams"
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<IconArrowLeft size={14} />}
            radius="xl"
          >
            Back
          </Button>
          <Box style={{ width: 1, height: 18, background: clubDesign.color.n3 }} />
          <Title order={2} ff={clubDesign.font.heading} fw={800} fz={{ base: 20, sm: 24 }} style={{ flex: 1, minWidth: 0 }}>
            {teamMeta.name}
          </Title>
          <Group gap="xs" wrap="wrap">
            {user && !myRole && (
              <Button size="xs" variant="light" loading={subscribing} onClick={handleSubscribe} radius="xl">
                Follow team
              </Button>
            )}
            {user && myRole?.role === 'subscriber' && (
              <Button size="xs" variant="subtle" color="gray" loading={subscribing} onClick={handleSubscribe} radius="xl">
                Unfollow
              </Button>
            )}
            <CopyButton value={calendarUrl} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy calendar link'} withArrow>
                  <Button
                    size="xs"
                    variant="outline"
                    color={copied ? 'teal' : undefined}
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    onClick={copy}
                    radius="xl"
                  >
                    {copied ? 'Link copied!' : 'Copy calendar link'}
                  </Button>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Paste the copied link into Google Calendar, Apple Calendar, or Outlook to subscribe.
        </Text>
      </Paper>

      {contacts.length > 0 && (
        <Paper p="md" withBorder radius="md">
          <Text fw={700} ff={clubDesign.font.heading} mb="sm">Team Contacts</Text>
          <Stack gap="xs">
            {contacts.map(c => (
              <Group key={c.id} gap="sm" wrap="nowrap">
                <Box
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: 'var(--mantine-primary-color-light)',
                    color: 'var(--mantine-primary-color-filled)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <IconUser size={16} />
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={600}>{c.name}</Text>
                  <Text size="xs" c="dimmed" tt="capitalize">{c.role}</Text>
                </Box>
                <Badge size="xs" variant="light" color={c.role === 'manager' ? 'blue' : 'teal'} radius="xl">
                  {c.role}
                </Badge>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      {feed === undefined ? (
        <Center py="xl"><Loader /></Center>
      ) : feed === null ? (
        <Alert icon={<IconAlertCircle size={16} />}>
          Fixture data is currently unavailable. Please check back later.
        </Alert>
      ) : (
        <Tabs defaultValue="fixtures">
          <Tabs.List>
            <Tabs.Tab value="fixtures" leftSection={<IconCalendar size={14} />}>
              Fixtures ({feed.fixtures.length})
            </Tabs.Tab>
            <Tabs.Tab value="results" leftSection={<IconTrophy size={14} />}>
              Results ({feed.results.length})
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="fixtures" pt="md">
            {feed.fixtures.length === 0 ? (
              <Text c="dimmed" size="sm">No upcoming fixtures.</Text>
            ) : (
              <Stack gap="xs">
                {[...feed.fixtures]
                  .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
                  .map((f) => (
                    <Paper key={f.id} p="md" withBorder radius="md">
                      <Box
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto 1fr',
                          gap: 16,
                          alignItems: 'center',
                        }}
                      >
                        <Box>
                          <Text fw={700} ff={clubDesign.font.heading} fz="sm" c={clubDesign.color.n9}>
                            {f.home_team}
                          </Text>
                          <Text size="xs" c="dimmed" mt={2}>Home</Text>
                        </Box>
                        <Stack gap={6} align="center">
                          <Box
                            px="sm"
                            py={6}
                            style={{
                              background: clubDesign.color.n1,
                              border: `1px solid ${clubDesign.color.n3}`,
                              borderRadius: 8,
                            }}
                          >
                            <Text ff={clubDesign.font.heading} fw={800} fz="xs" c={clubDesign.color.n5} style={{ letterSpacing: 2 }}>
                              VS
                            </Text>
                          </Box>
                          <Text size="xs" c="dimmed">{formatDate(f.date)} · {f.time}</Text>
                          <Badge variant="light" radius="xl" size="xs">{f.division}</Badge>
                        </Stack>
                        <Box style={{ textAlign: 'right' }}>
                          <Text fw={700} ff={clubDesign.font.heading} fz="sm" c={clubDesign.color.n9}>
                            {f.away_team}
                          </Text>
                          <Text size="xs" c="dimmed" mt={2}>{f.venue}</Text>
                        </Box>
                      </Box>
                    </Paper>
                  ))}
              </Stack>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="results" pt="md">
            {feed.results.length === 0 ? (
              <Text c="dimmed" size="sm">No results yet.</Text>
            ) : (
              <Stack gap="sm">
                <TeamResultsStats
                  results={[...feed.results].sort((a, b) => b.date.localeCompare(a.date))}
                  teamName={feed.team}
                />
                <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
                  <Table striped highlightOnHover>
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
                      {[...feed.results]
                        .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
                        .map((r) => (
                          <Table.Tr key={r.id}>
                            <Table.Td><Text size="xs" c="dimmed">{formatDate(r.date)}</Text></Table.Td>
                            <Table.Td><Text size="sm">{r.home_team}</Text></Table.Td>
                            <Table.Td ta="center">
                              <Text ff={clubDesign.font.heading} fw={800} fz="sm">
                                {r.home_score ?? 'X'} – {r.away_score ?? 'X'}
                              </Text>
                            </Table.Td>
                            <Table.Td><Text size="sm">{r.away_team}</Text></Table.Td>
                            <Table.Td visibleFrom="sm">
                              <Text size="xs" c="dimmed">{r.division}</Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              </Stack>
            )}
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
