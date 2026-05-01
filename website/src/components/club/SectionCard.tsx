import type { CSSProperties, ReactNode } from 'react';
import { Box, Group, Text } from '@mantine/core';
import { clubDesign } from '../../theme';

interface SectionCardProps {
  title?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  noPadding?: boolean;
}

/**
 * Generic white panel with rounded corners + subtle border. Optional title
 * row at the top with a trailing slot for "view all" links or filters.
 */
export function SectionCard({
  title,
  trailing,
  children,
  padding,
  style,
  noPadding,
}: SectionCardProps) {
  return (
    <Box
      style={{
        background: '#fff',
        border: `1px solid ${clubDesign.color.n3}`,
        borderRadius: clubDesign.radius.card,
        overflow: 'hidden',
        ...style,
      }}
    >
      {title && (
        <Group
          justify="space-between"
          align="center"
          px="lg"
          py="md"
          style={{ borderBottom: `1px solid ${clubDesign.color.n3}` }}
        >
          <Text ff={clubDesign.font.heading} fw={700} fz="md" c={clubDesign.color.n9}>
            {title}
          </Text>
          {trailing}
        </Group>
      )}
      <Box p={noPadding ? 0 : padding ?? 'lg'}>{children}</Box>
    </Box>
  );
}
