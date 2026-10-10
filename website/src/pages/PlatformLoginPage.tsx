import { Stack, Title, Text, Paper, Anchor, Box } from '@mantine/core';
import { Link } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
import type { AuthUser } from '../context/AuthContext';

/**
 * Sign-in at the multi-club platform root, for platform admins who belong to
 * no club. Unlike LoginPage it has no ClubContext dependency. The landing page
 * is mounted outside HashRouter, so success does a full navigation back to it.
 */
export function PlatformLoginPage() {
  const handleSuccess = async (user: AuthUser | null): Promise<string | null> => {
    // Club members go to their club; platform admins to the landing page.
    window.location.assign(user?.clubSlug ? `/${user.clubSlug}/` : '/');
    return null;
  };

  return (
    <Stack maw={420} mx="auto" mt="xl" gap="lg" px="md">
      <Box ta="center">
        <Title order={2} fw={800}>Platform Log In</Title>
        <Text c="dimmed" size="sm" mt={4}>Sign in as a platform admin.</Text>
      </Box>
      <Paper p="xl" radius="md" withBorder>
        <LoginForm onSuccess={handleSuccess} />
      </Paper>
      <Text size="sm" ta="center" c="dimmed">
        <Anchor component={Link} to="/forgot-password" fw={600}>Forgot your password?</Anchor>
      </Text>
    </Stack>
  );
}
