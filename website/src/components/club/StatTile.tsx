import type { ReactNode } from 'react';
import { Box, SimpleGrid, Stack, Text } from '@mantine/core';
import { clubDesign } from '../../theme';

export interface StatTileItem {
  value: ReactNode;
  label: ReactNode;
}

interface StatTileRowProps {
  items: StatTileItem[];
  cols?: number;
}

/**
 * Horizontal grid of stat tiles (large display number + small label). Mirrors
 * the design system's stats row used at the top of pages.
 */
export function StatTileRow({ items, cols = 4 }: StatTileRowProps) {
  return (
    <SimpleGrid
      cols={{ base: 2, sm: Math.min(cols, items.length) }}
      spacing={0}
      style={{
        background: '#fff',
        border: `1px solid ${clubDesign.color.n3}`,
        borderRadius: clubDesign.radius.card,
        overflow: 'hidden',
      }}
    >
      {items.map((it, i) => (
        <Box
          key={i}
          py="lg"
          px="md"
          style={{
            textAlign: 'center',
            borderRight:
              i < items.length - 1 ? `1px solid ${clubDesign.color.n3}` : undefined,
          }}
        >
          <Stack gap={2} align="center">
            <Text
              ff={clubDesign.font.heading}
              fw={800}
              fz={{ base: 24, sm: 28 }}
              c={clubDesign.color.n9}
              lh={1.1}
            >
              {it.value}
            </Text>
            <Text size="xs" c="dimmed" fw={500}>
              {it.label}
            </Text>
          </Stack>
        </Box>
      ))}
    </SimpleGrid>
  );
}
