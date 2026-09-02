import { useState } from 'react';
import { TextInput, PasswordInput, Button, Stack, Alert } from '@mantine/core';
import { signIn } from '../auth-client';
import { captureEvent } from '../lib/posthog';
import { useAuth, type AuthUser } from '../context/AuthContext';

interface Props {
  /**
   * Runs once the credentials are accepted and the session has been refreshed.
   * Return an error message to show instead of completing — LoginPage's
   * multi-club guard uses that to sign a wrong-club user back out — or null
   * when the caller is happy for the sign-in to stand.
   */
  onSuccess: (user: AuthUser | null) => Promise<string | null>;
}

/**
 * The credentials half of signing in, without any assumption about where it is
 * mounted. LoginPage wraps it in a club-scoped page; the platform landing page
 * puts it in a modal, where there is no HashRouter and no ClubContext to lean
 * on. Everything that differs between the two lives in `onSuccess`.
 */
export function LoginForm({ onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        captureEvent('login failed', { reason: 'rejected' });
        setError(result.error.message ?? 'Login failed');
        return;
      }

      const loggedInUser = await refresh();
      const rejection = await onSuccess(loggedInUser);
      if (rejection) {
        // onSuccess captures its own 'login failed' reason — it knows why.
        setError(rejection);
        return;
      }

      captureEvent('login succeeded');
    } catch {
      captureEvent('login failed', { reason: 'error' });
      setError('Login failed — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
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
  );
}
