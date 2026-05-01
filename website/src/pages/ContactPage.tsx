import { Title, Text, SimpleGrid, Paper, ThemeIcon, Group, Stack } from '@mantine/core';
import {
  IconMail, IconMapPin, IconBrandFacebook, IconBrandInstagram,
} from '@tabler/icons-react';
import type { Club } from '../types';

interface Props { club: Club }

export function ContactPage({ club }: Props) {
  const hasAddress = !!(club.address?.line1 || club.address?.line2 || club.address?.postcode);
  const addressLines = [club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean);
  const hasFacebook = club.socials?.facebook && club.socials.facebook !== '#';
  const hasInstagram = club.socials?.instagram && club.socials.instagram !== '#';

  return (
    <Stack gap="xl">
      <div>
        <Title order={2} mb="xs">Contact Us</Title>
        <Text c="dimmed">
          Whether you're interested in playing, coaching, sponsoring, or just want to come
          along and watch — we'd love to hear from you.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {club.email && (
          <Paper p="md" radius="md" withBorder>
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon variant="light" size="lg" radius="md">
                <IconMail size={18} />
              </ThemeIcon>
              <div>
                <Text fw={600} mb={4}>Email</Text>
                <Text component="a" href={`mailto:${club.email}`} c="var(--mantine-primary-color-filled)" size="sm">
                  {club.email}
                </Text>
              </div>
            </Group>
          </Paper>
        )}

        {(hasAddress || club.what3words) && (
          <Paper p="md" radius="md" withBorder>
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon variant="light" size="lg" radius="md">
                <IconMapPin size={18} />
              </ThemeIcon>
              <div>
                <Text fw={600} mb={4}>Ground Address</Text>
                {hasAddress && (
                  <Text size="sm">
                    {addressLines.map((line, i) => (
                      <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
                    ))}
                  </Text>
                )}
                {club.what3words && (
                  <Text size="sm" mt={hasAddress ? 'xs' : 0}>
                    What3Words: <strong>{club.what3words}</strong>
                  </Text>
                )}
              </div>
            </Group>
          </Paper>
        )}

        {hasFacebook && (
          <Paper p="md" radius="md" withBorder>
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon color="blue" variant="light" size="lg" radius="md">
                <IconBrandFacebook size={18} />
              </ThemeIcon>
              <div>
                <Text fw={600} mb={4}>Facebook</Text>
                <Text component="a" href={club.socials.facebook} target="_blank" rel="noopener noreferrer" c="blue.6" size="sm">
                  Follow us on Facebook
                </Text>
              </div>
            </Group>
          </Paper>
        )}

        {hasInstagram && (
          <Paper p="md" radius="md" withBorder>
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon color="grape" variant="light" size="lg" radius="md">
                <IconBrandInstagram size={18} />
              </ThemeIcon>
              <div>
                <Text fw={600} mb={4}>Instagram</Text>
                <Text component="a" href={club.socials.instagram} target="_blank" rel="noopener noreferrer" c="grape.6" size="sm">
                  Follow us on Instagram
                </Text>
              </div>
            </Group>
          </Paper>
        )}
      </SimpleGrid>
    </Stack>
  );
}
