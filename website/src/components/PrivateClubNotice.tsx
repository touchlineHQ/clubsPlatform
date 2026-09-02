import { Anchor, Card, Center, Stack, Text, Title } from '@mantine/core';
import { clubDesign } from '../theme';

interface Props {
  /** Multi-club deployments have a platform landing page at "/" to link back to. */
  multiClub: boolean;
}

/**
 * What a visitor gets when a club's site hasn't gone live yet.
 *
 * The club's own admins never see this: they're let through the gate in
 * App.tsx. Everyone else gets a holding card, and the "#/login" link stays
 * reachable — an admin arriving cold on their own club's URL signs in from
 * right here rather than being bounced somewhere that can't help them.
 *
 * On the multi-club platform the card also links back to the landing page, so a
 * half-built club site isn't a dead end for someone who followed a link.
 */
export function PrivateClubNotice({ multiClub }: Props) {
  return (
    <Center h="100vh" px="md">
      <Card withBorder radius="md" p="xl" maw={420}>
        <Stack gap="xs">
          <Title order={3} ff={clubDesign.font.heading} fw={800}>
            Not live yet
          </Title>
          <Text size="sm" c="dimmed">
            This club's site is still being set up and isn't public yet. Please check back soon.
          </Text>
          <Anchor href="#/login" size="sm" mt="xs">
            Club admin? Log in
          </Anchor>
          {multiClub && (
            <Anchor href="/" size="sm">
              Browse clubsPlatform
            </Anchor>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
