import { useState } from 'react';
import { PasswordInput, Button, Stack, Title, Text, Paper, Anchor, Alert, Box } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authClient } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { clubDesign } from '../theme';

/** Matches SIGNUP_LIMITS.passwordMin, which the server enforces on this route too. */
const PASSWORD_MIN = 10;

/**
 * Where both the forgot-password link and the import invitation land — they
 * carry the same kind of token, so the wording avoids assuming the reader
 * has had an account before.
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters`);
      return;
    }
    if (password !== confirm) {
      setError('Both passwords must match');
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        captureEvent('password reset failed', { reason: 'rejected' });
        setError(
          result.error.message
            ?? 'That link is no longer valid. Request a new one and try again.',
        );
        return;
      }
      captureEvent('password reset completed');
      setDone(true);
    } catch {
      captureEvent('password reset failed', { reason: 'error' });
      setError('Something went wrong — please request a new link and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Stack maw={420} mx="auto" mt="xl" gap="lg">
        <Box ta="center">
          <Title order={2} ff={clubDesign.font.heading} fw={800}>Set a Password</Title>
        </Box>
        <Paper p="xl" radius="md" withBorder>
          <Stack gap="md">
            <Alert color="red" variant="light" radius="md">
              This link is missing its token, so there's nothing to reset.
            </Alert>
            <Button component={Link} to="/forgot-password" radius="xl" size="md" fullWidth>
              Request a new link
            </Button>
          </Stack>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack maw={420} mx="auto" mt="xl" gap="lg">
      <Box ta="center">
        <Title order={2} ff={clubDesign.font.heading} fw={800}>Set a Password</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Choose a password of at least {PASSWORD_MIN} characters.
        </Text>
      </Box>
      <Paper p="xl" radius="md" withBorder>
        {done ? (
          <Stack gap="md">
            <Alert color="green" variant="light" radius="md">
              Your password is set. You can log in with it now.
            </Alert>
            <Button onClick={() => navigate('/login', { replace: true })} radius="xl" size="md" fullWidth>
              Go to log in
            </Button>
          </Stack>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
              <PasswordInput
                label="New password"
                required
                radius="md"
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label="Confirm new password"
                required
                radius="md"
                value={confirm}
                onChange={e => setConfirm(e.currentTarget.value)}
              />
              <Button type="submit" loading={loading} fullWidth radius="xl" size="md">
                Save password
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
      {!done && (
        <Text size="sm" ta="center" c="dimmed">
          Link expired?{' '}
          <Anchor component={Link} to="/forgot-password" fw={600}>
            Request a new one
          </Anchor>
        </Text>
      )}
    </Stack>
  );
}
