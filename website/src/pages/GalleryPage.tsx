import { Text, SimpleGrid, Paper, Image, Center, Stack, Box } from '@mantine/core';
import { IconCamera } from '@tabler/icons-react';
import type { GalleryItem } from '../types';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props { items: GalleryItem[] }

export function GalleryPage({ items }: Props) {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Gallery"
        subtitle="Photos coming soon — team photos, matchday action, club events and more."
      />

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        {items.map((item, i) => (
          <Paper key={i} radius="md" withBorder style={{ overflow: 'hidden' }}>
            {item.src ? (
              <>
                <Image src={item.src} alt={item.caption} h={160} fit="cover" />
                <Box px="sm" py={6} style={{ borderTop: `1px solid ${clubDesign.color.n3}` }}>
                  <Text size="xs" c="dimmed" ta="center">{item.caption}</Text>
                </Box>
              </>
            ) : (
              <Center h={160} bg={clubDesign.color.n2}>
                <Stack align="center" gap={4}>
                  <IconCamera size={28} color={clubDesign.color.n5} />
                  <Text size="xs" c="dimmed">{item.caption}</Text>
                </Stack>
              </Center>
            )}
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
