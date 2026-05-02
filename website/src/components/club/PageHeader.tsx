import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, Title } from '@mantine/core';
import { clubDesign } from '../../theme';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned content (filter pills, action buttons, etc.) */
  actions?: ReactNode;
  /** Slot rendered below the title row, full-width (e.g. tab bar). */
  below?: ReactNode;
}

/**
 * Page header used at the top of each club page. Matches the design system's
 * page-header pattern: bold display title + smaller dimmed subtitle, plus an
 * optional row of actions. Sits flush to the top of the page content with a
 * subtle bottom divider.
 */
export function PageHeader({ title, subtitle, actions, below }: PageHeaderProps) {
  return (
    <Box
      style={{
        background: '#fff',
        borderRadius: clubDesign.radius.card,
        border: `1px solid ${clubDesign.color.n3}`,
        overflow: 'hidden',
      }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="wrap"
        gap="md"
        p={{ base: 'md', sm: 'xl' }}
      >
        <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
          <Title order={2} ff={clubDesign.font.heading} fw={800} fz={{ base: 22, sm: 26 }}>
            {title}
          </Title>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </Stack>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
      {below && (
        <Box style={{ borderTop: `1px solid ${clubDesign.color.n3}` }}>{below}</Box>
      )}
    </Box>
  );
}
