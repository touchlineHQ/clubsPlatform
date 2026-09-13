import { useState } from 'react';
import { TextInput, Button, Stack, Title, Text, Paper, Anchor, Alert, Box } from '@mantine/core';
import { Link } from 'react-router-dom';
import { authClient } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { clubDesign } from '../theme';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await authClient.requestPasswordReset({ email });
      captureEvent('password reset requested');
    } catch {
      // Deliberately not surfaced. The confirmation below is identical whether
      // the address has an account, has none, or the request failed outright —
      // anything else turns this form into a way of testing whether a given
      // parent is registered with the club.
      captureEvent('password reset request failed');
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <Stack maw={420} mx="auto" mt="xl" gap="lg">
      <Box ta="center">
        <Title order={2} ff={clubDesign.font.heading} fw={800}>Forgot Password</Title>
        <Text c="dimmed" size="sm" mt={4}>
          We'll email you a link to choose a new one.
        </Text>
      </Box>
      <Paper p="xl" radius="md" withBorder>
        {sent ? (
          <Stack gap="md">
            <Alert color="green" variant="light" radius="md">
              If that address has an account, a reset link is on its way. It expires in an hour.
            </Alert>
            <Text size="sm" c="dimmed">
              Nothing arrived? Check your spam folder, then try again — and make sure you're
              using the address your club has on file.
            </Text>
          </Stack>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="Email"
                type="email"
                required
                radius="md"
                value={email}
                onChange={e => setEmail(e.currentTarget.value)}
              />
              <Button type="submit" loading={loading} fullWidth radius="xl" size="md">
                Send reset link
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
      <Text size="sm" ta="center" c="dimmed">
        Remembered it?{' '}
        <Anchor component={Link} to="/login" fw={600}>
          Back to log in
        </Anchor>
      </Text>
    </Stack>
  );
}
