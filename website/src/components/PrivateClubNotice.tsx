import { useEffect } from 'react';
import { Anchor, Card, Center, Stack, Text, Title } from '@mantine/core';
import { clubDesign } from '../theme';

interface Props {
  /** Multi-club deployments have a platform landing page at "/" to fall back to. */
  multiClub: boolean;
}

/**
 * What a visitor gets when a club's site hasn't gone live yet.
 *
 * On the multi-club platform they're sent to the landing page — a half-built
 * club site shouldn't be a dead end for someone who followed a link. A
 * single-club fork has no landing page to fall back to (redirecting to "/"
 * there would loop straight back into this component), so it shows a holding
 * card instead.
 *
 * The club's admins never see this: they're let through the gate in App.tsx.
 * #/login stays reachable so an admin can sign in from here.
 */
export function PrivateClubNotice({ multiClub }: Props) {
  useEffect(() => {
    if (multiClub) window.location.replace('/');
  }, [multiClub]);

  if (multiClub) return null;

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
        </Stack>
      </Card>
    </Center>
  );
}
