import { useMemo } from 'react';
import { Text, SimpleGrid, Paper, Badge, Button, Group, Stack, Image, Center, Box, Divider } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconCamera, IconCalendar, IconUsers } from '@tabler/icons-react';
import type { TeamsData, LiveTeam } from '../types';
import { useSection } from '../context/SectionContext';
import { liveTeamsForTeam, findDuplicateTeamNames, teamDisplayLabel } from '../utils/teamMatching';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props {
  teams: TeamsData;
  liveTeams: LiveTeam[];
}

function TeamCard({ team, liveTeams }: { team: Props['teams']['sections'][0]['teams'][0]; liveTeams: LiveTeam[] }) {
  const duplicateNames = useMemo(() => findDuplicateTeamNames(liveTeams), [liveTeams]);
  return (
    <Paper p={0} radius="md" withBorder style={{ overflow: 'hidden' }}>
      {team.photo ? (
        <Image src={team.photo} alt={team.name} h={160} fit="cover" />
      ) : (
        <Center h={140} bg={clubDesign.color.n2}>
          <Stack align="center" gap={4}>
            <IconCamera size={28} color={clubDesign.color.n5} />
            <Text size="xs" c="dimmed">Team Photo</Text>
          </Stack>
        </Center>
      )}

      <Stack gap="xs" p="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box>
            <Text fw={800} ff={clubDesign.font.heading} fz="md">{team.name}</Text>
            {team.description && (
              <Text size="sm" c="dimmed" lineClamp={2}>{team.description}</Text>
            )}
          </Box>
        </Group>

        <Stack gap={2} mt={4}>
          <Text size="xs" c="dimmed">
            <Text component="span" fw={600} c={clubDesign.color.n7}>{team.managerLabel ?? 'Manager'}:</Text>{' '}
            {team.manager}
          </Text>
          <Text size="xs" c="dimmed">
            <Text component="span" fw={600} c={clubDesign.color.n7}>{team.coachLabel ?? 'Coach'}:</Text>{' '}
            {team.coach}
          </Text>
        </Stack>

        <Group gap="xs" mt="xs">
          <Button component={Link} to="/register" size="xs" radius="xl">Register</Button>
          <Button component={Link} to="/contact" size="xs" variant="outline" radius="xl">Contact</Button>
          {liveTeams.length === 1 && (
            <Button
              component={Link}
              to={`/teams/${liveTeams[0].league}/${liveTeams[0].slug}`}
              size="xs"
              variant="light"
              radius="xl"
              leftSection={<IconCalendar size={12} />}
            >
              Fixtures
            </Button>
          )}
        </Group>

        {liveTeams.length > 1 && (
          <>
            <Divider />
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>
              Live teams
            </Text>
            <Stack gap={4}>
              {liveTeams.map((lt) => (
                <Button
                  key={`${lt.league}/${lt.slug}`}
                  component={Link}
                  to={`/teams/${lt.league}/${lt.slug}`}
                  size="xs"
                  variant="light"
                  radius="xl"
                  leftSection={<IconCalendar size={12} />}
                  fullWidth
                >
                  {teamDisplayLabel(lt.name, lt.league, duplicateNames)}
                </Button>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}

export function TeamsPage({ teams, liveTeams }: Props) {
  const { activeSection } = useSection();
  const visibleSections = teams.sections.filter(
    s => activeSection === 'all' || s.id === activeSection
  );
  const totalTeams = visibleSections.reduce((sum, s) => sum + s.teams.length, 0);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Teams &amp; Squads"
        subtitle={`${totalTeams} ${totalTeams === 1 ? 'team' : 'teams'} across ${visibleSections.length} ${visibleSections.length === 1 ? 'section' : 'sections'}`}
      />

      {visibleSections.map((section, si) => (
        <Box key={si}>
          {/* Section divider with name + team count */}
          <Group align="center" mb="sm" gap="sm">
            <IconUsers size={18} color="var(--mantine-primary-color-filled)" />
            <Text fw={800} ff={clubDesign.font.heading} fz="lg" c={clubDesign.color.n9}>
              {section.name}
            </Text>
            {section.subtitle && (
              <Badge variant="light" radius="xl" size="sm">{section.subtitle}</Badge>
            )}
            <Box style={{ flex: 1, height: 1, background: clubDesign.color.n3 }} />
            <Text size="xs" c="dimmed">
              {section.teams.length} {section.teams.length === 1 ? 'team' : 'teams'}
            </Text>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {section.teams.map((team, ti) => (
              <TeamCard key={ti} team={team} liveTeams={liveTeamsForTeam(team, liveTeams)} />
            ))}
          </SimpleGrid>
        </Box>
      ))}
    </Stack>
  );
}
