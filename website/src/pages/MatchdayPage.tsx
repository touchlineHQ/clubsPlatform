import { Text, SimpleGrid, Paper, ThemeIcon, Group, Stack, Badge, Image, Box } from '@mantine/core';
import { IconMapPin } from '@tabler/icons-react';
import type { Club, MatchdayItem } from '../types';
import { tablerIcon } from '../utils/icons';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props {
  items: MatchdayItem[];
  club: Club;
}

export function MatchdayPage({ items, club }: Props) {
  const badges = club.matchdayBadges ?? [];
  const groundImage = club.groundImage;
  const groundImageAlt = club.groundImageAlt ?? `${club.name} — ground map`;
  const fullAddress = [club.address?.line1, club.address?.line2, club.address?.postcode]
    .filter(Boolean)
    .join(', ');

  return (
    <Stack gap="lg">
      <PageHeader
        title="Visitor &amp; Matchday Information"
        subtitle={fullAddress || undefined}
      />

      {badges.length > 0 && (
        <Group gap="xs">
          {badges.map((badge, i) => (
            <Badge key={i} color={badge.color} variant="light" radius="xl" size="lg">
              {badge.label}
            </Badge>
          ))}
        </Group>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {items.map((item, i) => (
          <Paper key={i} p="lg" radius="md" withBorder>
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon variant="light" size="lg" radius="md">
                {tablerIcon(item.icon)}
              </ThemeIcon>
              <Box>
                <Text fw={700} ff={clubDesign.font.heading} mb={4}>{item.title}</Text>
                <Text size="sm" c="dimmed" lh={1.6} dangerouslySetInnerHTML={{ __html: item.text }} />
              </Box>
            </Group>
          </Paper>
        ))}
      </SimpleGrid>

      {groundImage && (
        <Paper radius="md" withBorder style={{ overflow: 'hidden' }}>
          <Box
            px="lg"
            py="md"
            style={{ borderBottom: `1px solid ${clubDesign.color.n3}` }}
          >
            <Text fw={700} ff={clubDesign.font.heading}>Getting Here</Text>
          </Box>
          <Image src={groundImage} alt={groundImageAlt} style={{ display: 'block', maxHeight: 360, objectFit: 'cover', width: '100%' }} />
          {(fullAddress || club.what3words) && (
            <Group
              gap="xs"
              align="center"
              px="lg"
              py="sm"
              style={{ background: clubDesign.color.n1 }}
            >
              <IconMapPin size={14} color={clubDesign.color.n6} />
              <Text size="xs" c={clubDesign.color.n7}>
                {fullAddress}
                {club.what3words && (
                  <>
                    {' · '}
                    <Text component="span" fw={700} c={clubDesign.color.n8}>
                      What3Words: {club.what3words}
                    </Text>
                  </>
                )}
              </Text>
            </Group>
          )}
        </Paper>
      )}
    </Stack>
  );
}
