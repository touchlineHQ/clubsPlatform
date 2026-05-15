import { useState } from 'react';
import { TextInput, PasswordInput, Button, Stack, Title, Text, Paper, Anchor, Alert, Box } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signIn, signOut } from '../auth-client';
import { useAuth } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import { clubDesign } from '../theme';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const { clubSlug: currentClubSlug, isMultiClub } = useClub();

  const rawRedirect = searchParams.get('redirectTo');
  // Only honour same-app paths to prevent open-redirect.
  const redirectTo = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
    ? rawRedirect
    : '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Login failed');
      } else {
        const loggedInUser = await refresh();

        // In multi-club mode, reject users who belong to a different club.
        // Platform admins (clubSlug === null) are allowed everywhere.
        if (isMultiClub && loggedInUser && loggedInUser.clubSlug !== null && loggedInUser.clubSlug !== currentClubSlug) {
          await signOut();
          await refresh();
          setError('This account is not registered with this club. Please log in on the correct club page.');
          return;
        }

        navigate(redirectTo, { replace: true });
      }
    } catch {
      setError('Login failed — please try again');
    } finally {
      setLoading(false);
    }
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
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
            <TextInput
              label="Email"
              type="email"
              required
              radius="md"
              value={email}
              onChange={e => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              required
              radius="md"
              value={password}
              onChange={e => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={loading} fullWidth radius="xl" size="md">
              Log In
            </Button>
          </Stack>
        </form>
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
