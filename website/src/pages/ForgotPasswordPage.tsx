import { useState } from 'react';
import { TextInput, Button, Stack, Title, Text, Paper, Anchor, Alert, Box } from '@mantine/core';
import { IconMailCheck } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { clubDesign } from '../theme';

/**
 * Step one of the password reset.
 *
 * The confirmation is deliberately the same whether or not the address has an
 * account: a page that says "no account with that email" tells anyone who asks
 * which parents are on the club's books.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // The endpoint answers 200 whether or not the address has an account, so
      // an error here is a real fault — never "no such user".
      const result = await requestPasswordReset({ email: email.trim() });
      if (result.error) {
        captureEvent('password reset request failed', { reason: 'rejected' });
        setError('Something went wrong — please try again.');
        return;
      }
      captureEvent('password reset requested');
      setSent(true);
    } catch {
      captureEvent('password reset request failed', { reason: 'error' });
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
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
          <Alert color="green" variant="light" radius="md" icon={<IconMailCheck size={18} />}>
            If an account exists for that address, a reset link is on its way. The
            link expires in an hour and can only be used once.
          </Alert>
        ) : (
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
              <Button type="submit" loading={loading} fullWidth radius="xl" size="md">
                Send reset link
              </Button>
            </Stack>
          </form>
        )}
      </Paper>

      <Text size="sm" ta="center" c="dimmed">
        Remembered it?{' '}
        <Anchor component={Link} to="/login" fw={600}>Back to sign in</Anchor>
      </Text>
    </Stack>
  );
}
