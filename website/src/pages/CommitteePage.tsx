import { Text, Stack, Box, Paper, Group } from '@mantine/core';
import type { CommitteeData, TeamsData } from '../types';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props {
  committee: CommitteeData;
  teams: TeamsData;
}

interface RoleRowProps {
  primary: string;
  secondary?: string;
  detail?: string;
  contact?: string;
}

function RoleRow({ primary, secondary, detail, contact }: RoleRowProps) {
  return (
    <Group
      align="center"
      justify="space-between"
      wrap="wrap"
      gap="md"
      py="sm"
      style={{ borderBottom: `1px solid ${clubDesign.color.n2}` }}
    >
      <Box style={{ flex: 1, minWidth: 220 }}>
        <Text fw={700} ff={clubDesign.font.heading} fz="sm" c={clubDesign.color.n9}>
          {primary}
        </Text>
        {secondary && <Text size="xs" c="dimmed" mt={2}>{secondary}</Text>}
      </Box>
      {detail && (
        <Text size="sm" c={clubDesign.color.n7} fw={500}>
          {detail}
        </Text>
      )}
      {contact && (
        <Text size="sm" c="var(--mantine-primary-color-filled)" fw={600}>
          {contact}
        </Text>
      )}
    </Group>
  );
}

export function CommitteePage({ committee, teams }: Props) {
  const totalCommittee = committee.committee?.length ?? 0;
  const totalStaff = teams.sections.reduce((sum, s) => sum + s.teams.length, 0);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Committee &amp; Staff"
        subtitle={`${totalCommittee} committee member${totalCommittee === 1 ? '' : 's'} · ${totalStaff} team coach${totalStaff === 1 ? '' : 'es'}`}
      />

      {committee.committee?.length > 0 && (
        <Paper radius="md" withBorder p="lg">
          <Text fw={800} ff={clubDesign.font.heading} fz="md" mb="sm" c={clubDesign.color.n9}>
            Club Committee
          </Text>
          <Box>
            {committee.committee.map((m, i) => (
              <RoleRow
                key={i}
                primary={m.role}
                detail={m.name}
                contact={m.contact}
              />
            ))}
          </Box>
        </Paper>
      )}

      {teams.sections.length > 0 && (
        <Paper radius="md" withBorder p="lg">
          <Text fw={800} ff={clubDesign.font.heading} fz="md" mb="sm" c={clubDesign.color.n9}>
            Managers &amp; Coaches
          </Text>
          <Stack gap="lg">
            {teams.sections.map((section, si) => (
              <Box key={si}>
                <Text
                  size="xs"
                  fw={700}
                  tt="uppercase"
                  c="dimmed"
                  mb={4}
                  style={{ letterSpacing: '0.05em' }}
                >
                  {section.name}
                </Text>
                {section.teams.map((team, ti) => (
                  <RoleRow
                    key={ti}
                    primary={team.name}
                    secondary={`Manager: ${team.manager} · Coach: ${team.coach}`}
                    contact={team.contact}
                  />
                ))}
              </Box>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
