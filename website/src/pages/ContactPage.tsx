import { Text, SimpleGrid, Paper, ThemeIcon, Group, Stack, Box } from '@mantine/core';
import {
  IconMail, IconMapPin, IconBrandFacebook, IconBrandInstagram, IconBrandTwitter,
} from '@tabler/icons-react';
import type { Club } from '../types';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Props { club: Club }

interface ContactCardProps {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
  children: React.ReactNode;
}

function ContactCard({ icon, title, iconColor, children }: ContactCardProps) {
  return (
    <Paper p="lg" radius="md" withBorder>
      <Group align="flex-start" gap="md" wrap="nowrap">
        <ThemeIcon variant="light" size="lg" radius="md" color={iconColor}>
          {icon}
        </ThemeIcon>
        <Box>
          <Text fw={700} ff={clubDesign.font.heading} mb={4}>{title}</Text>
          {children}
        </Box>
      </Group>
    </Paper>
  );
}

export function ContactPage({ club }: Props) {
  const hasAddress = !!(club.address?.line1 || club.address?.line2 || club.address?.postcode);
  const addressLines = [club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean);
  const hasFacebook = club.socials?.facebook && club.socials.facebook !== '#';
  const hasInstagram = club.socials?.instagram && club.socials.instagram !== '#';
  const hasTwitter = club.socials?.twitter && club.socials.twitter !== '#';

  return (
    <Stack gap="lg">
      <PageHeader
        title="Contact Us"
        subtitle="Whether you're interested in playing, coaching, sponsoring, or just want to come along and watch — we'd love to hear from you."
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {club.email && (
          <ContactCard icon={<IconMail size={18} />} title="Email">
            <Text component="a" href={`mailto:${club.email}`} c="var(--mantine-primary-color-filled)" size="sm" fw={600} style={{ textDecoration: 'none' }}>
              {club.email}
            </Text>
          </ContactCard>
        )}

        {(hasAddress || club.what3words) && (
          <ContactCard icon={<IconMapPin size={18} />} title="Ground Address">
            {hasAddress && (
              <Text size="sm" c={clubDesign.color.n7}>
                {addressLines.map((line, i) => (
                  <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
                ))}
              </Text>
            )}
            {club.what3words && (
              <Text size="sm" c="dimmed" mt={hasAddress ? 'xs' : 0}>
                What3Words: <Text component="span" fw={700} c={clubDesign.color.n8}>{club.what3words}</Text>
              </Text>
            )}
          </ContactCard>
        )}

        {hasFacebook && (
          <ContactCard icon={<IconBrandFacebook size={18} />} title="Facebook" iconColor="blue">
            <Text component="a" href={club.socials.facebook} target="_blank" rel="noopener noreferrer" c="blue.6" size="sm" fw={600} style={{ textDecoration: 'none' }}>
              Follow us on Facebook
            </Text>
          </ContactCard>
        )}

        {hasInstagram && (
          <ContactCard icon={<IconBrandInstagram size={18} />} title="Instagram" iconColor="grape">
            <Text component="a" href={club.socials.instagram} target="_blank" rel="noopener noreferrer" c="grape.6" size="sm" fw={600} style={{ textDecoration: 'none' }}>
              Follow us on Instagram
            </Text>
          </ContactCard>
        )}

        {hasTwitter && (
          <ContactCard icon={<IconBrandTwitter size={18} />} title="Twitter / X" iconColor="cyan">
            <Text component="a" href={club.socials.twitter} target="_blank" rel="noopener noreferrer" c="cyan.7" size="sm" fw={600} style={{ textDecoration: 'none' }}>
              Follow us on X
            </Text>
          </ContactCard>
        )}
      </SimpleGrid>
    </Stack>
  );
}
