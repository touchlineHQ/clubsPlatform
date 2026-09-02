import { Stack, Title, Text, Paper, Anchor, Box } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signOut } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { LoginForm } from '../components/LoginForm';
import { useAuth, type AuthUser } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import { clubDesign } from '../theme';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const { clubSlug: currentClubSlug, isMultiClub } = useClub();

  const rawRedirect = searchParams.get('redirectTo');
  // Only honour same-app paths to prevent open-redirect.
  const redirectTo = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
    ? rawRedirect
    : '/';

  const handleSuccess = async (loggedInUser: AuthUser | null): Promise<string | null> => {
    // In multi-club mode, reject users who belong to a different club.
    // Platform admins (clubSlug === null) are allowed everywhere.
    if (isMultiClub && loggedInUser && loggedInUser.clubSlug !== null && loggedInUser.clubSlug !== currentClubSlug) {
      await signOut();
      await refresh();
      captureEvent('login failed', { reason: 'wrong_club' });
      return 'This account is not registered with this club. Please log in on the correct club page.';
    }

    navigate(redirectTo, { replace: true });
    return null;
  };

  return (
    <Stack maw={420} mx="auto" mt="xl" gap="lg">
      <Box ta="center">
        <Title order={2} ff={clubDesign.font.heading} fw={800}>Log In</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Welcome back. Sign in to manage your team and bookings.
        </Text>
      </Box>
      <Paper p="xl" radius="md" withBorder>
        <LoginForm onSuccess={handleSuccess} />
      </Paper>
      <Text size="sm" ta="center" c="dimmed">
        Don't have an account?{' '}
        <Anchor
          component={Link}
          to={`/signup${rawRedirect ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`}
          fw={600}
        >
          Sign up
        </Anchor>
      </Text>
    </Stack>
  );
}
