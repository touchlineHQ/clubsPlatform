import { Text, SimpleGrid, Paper, Button, Stack, ThemeIcon, Box } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type { RegistrationItem } from '../types';
import { tablerIcon } from '../utils/icons';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props { items: RegistrationItem[] }

export function RegisterPage({ items }: Props) {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Registration &amp; Subscriptions"
        subtitle={
          <>
            Ready to join or renew? Use the links below to register and pay your subscriptions
            online via GoCardless. If you have any questions,{' '}
            <Text component={Link} to="/contact" c="var(--mantine-primary-color-filled)" size="sm" fw={600} style={{ textDecoration: 'none' }}>
              get in touch
            </Text>.
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {items.map((item, i) => (
          <Paper key={i} p="xl" radius="md" withBorder>
            <Stack gap="md" h="100%">
              <ThemeIcon variant="light" size="xl" radius="md">
                {tablerIcon(item.icon)}
              </ThemeIcon>
              <Box style={{ flex: 1 }}>
                <Text fw={800} ff={clubDesign.font.heading} fz="md" mb={4}>{item.title}</Text>
                <Text size="sm" c="dimmed" lh={1.55}>{item.description}</Text>
              </Box>
              <Button
                component="a"
                href={item.link}
                fullWidth
                radius="xl"
                rightSection={<IconArrowRight size={14} />}
              >
                {item.buttonText}
              </Button>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
