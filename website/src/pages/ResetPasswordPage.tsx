import { useState } from 'react';
import { PasswordInput, Button, Stack, Title, Text, Paper, Anchor, Alert, Box } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { clubDesign } from '../theme';

/**
 * Step two of the password reset, and also where an imported parent lands from
 * their welcome email — both arrive with a `reset-password` token, so one page
 * serves "I forgot my password" and "set your password for the first time".
 */

/** Kept in step with SIGNUP_LIMITS.passwordMin in functions/lib/signup-validation.ts. */
const PASSWORD_MIN = 10;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const result = await resetPassword({ newPassword: password, token });
      if (result.error) {
        captureEvent('password reset failed', { reason: 'rejected' });
        setError(
          result.error.message ??
          'That link is no longer valid. Request a new one and try again.'
        );
      } else {
        captureEvent('password reset completed');
        setDone(true);
      }
    } catch {
      captureEvent('password reset failed', { reason: 'error' });
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Stack maw={420} mx="auto" mt="xl" gap="lg">
        <Box ta="center">
          <Title order={2} ff={clubDesign.font.heading} fw={800}>Reset Password</Title>
        </Box>
        <Alert color="red" variant="light" radius="md">
          This link is missing its reset code. Request a new one from{' '}
          <Anchor component={Link} to="/forgot-password" fw={600}>Forgot password</Anchor>.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack maw={420} mx="auto" mt="xl" gap="lg">
      <Box ta="center">
        <Title order={2} ff={clubDesign.font.heading} fw={800}>Choose a Password</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Pick something at least {PASSWORD_MIN} characters long.
        </Text>
      </Box>

      <Paper p="xl" radius="md" withBorder>
        {done ? (
          <Stack gap="md">
            <Alert color="green" variant="light" radius="md" icon={<IconCheck size={18} />}>
              Your password is set. Any other devices you were signed in on have
              been signed out.
            </Alert>
            <Button component={Link} to="/login" fullWidth radius="xl" size="md">
              Sign in
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
    </Stack>
  );
}
