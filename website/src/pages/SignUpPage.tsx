import { useState } from 'react';
import { TextInput, PasswordInput, Button, Stack, Title, Text, Paper, Anchor, Alert } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signUp } from '../auth-client';
import { useAuth } from '../context/AuthContext';

export function SignUpPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();

  const rawRedirect = searchParams.get('redirectTo');
  const redirectTo = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
    ? rawRedirect
    : '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? 'Registration failed');
      } else {
        await refresh();
        navigate(redirectTo, { replace: true });
      }
    } catch {
      setError('Registration failed — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack maw={400} mx="auto" mt="xl">
      <Title order={2}>Create Account</Title>
      <Paper p="xl" withBorder>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && <Alert color="red" variant="light">{error}</Alert>}
            <TextInput
              label="Full Name"
              required
              value={name}
              onChange={e => setName(e.currentTarget.value)}
            />
            <TextInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              required
              value={password}
              onChange={e => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={loading} fullWidth>
              Create Account
            </Button>
          </Stack>
        </form>
      </Paper>
      <Text size="sm" ta="center">
        Already have an account? <Anchor component={Link} to={`/login${rawRedirect ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`}>Log in</Anchor>
      </Text>
    </Stack>
  );
}
