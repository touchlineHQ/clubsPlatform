import { Title, Text, SimpleGrid, Paper, ThemeIcon, Group, Stack, Divider } from '@mantine/core';
import type { Club } from '../types';
import { tablerIcon } from '../utils/icons';

interface Props { club: Club }

export function AboutPage({ club }: Props) {
  const hasHistory = club.history && club.history.length > 0;
  const hasAbout = club.about && club.about.length > 0;

  return (
    <Stack gap="xl">
      {hasHistory && (
        <div>
          <Title order={2} mb="md">Our Story</Title>
          {club.history.map((p, i) => (
            <Text key={i} mb="sm">{p}</Text>
          ))}
        </div>
      )}

      {hasHistory && hasAbout && <Divider />}

      {hasAbout && (
        <div>
          <Title order={2} mb="md">Who We Are</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {club.about.map((item, i) => (
              <Paper key={i} p="md" radius="md" withBorder>
                <Group align="flex-start" gap="md" wrap="nowrap">
                  <ThemeIcon variant="light" size="lg" radius="md">
                    {tablerIcon(item.icon)}
                  </ThemeIcon>
                  <div>
                    <Text fw={600} mb={4}>{item.title}</Text>
                    <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: item.text }} />
                  </div>
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </div>
      )}

      {!hasHistory && !hasAbout && (
        <Text c="dimmed">No club history or about information has been added yet.</Text>
      )}
    </Stack>
  );
}
