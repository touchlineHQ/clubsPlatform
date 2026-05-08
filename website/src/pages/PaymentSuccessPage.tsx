import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Badge, Button, Center, Code, Group, Paper, Stack, Text, Title,
} from '@mantine/core';
import { IconCheck, IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';

export function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [params, setParams] = useState<URLSearchParams | null>(null);

  useEffect(() => {
    setParams(new URLSearchParams(window.location.hash.split('?')[1] ?? ''));
  }, []);

  if (!params) return <Center h={200} />;

  const mandate = params.get('mandate');
  const subscription = params.get('subscription');
  const ref = params.get('ref');
  const amountStr = params.get('amount');
  const intervalUnit = params.get('interval_unit') ?? 'monthly';
  const isExisting = params.get('existing') === '1';
  const hasWarning = params.get('warning') === 'subscription_failed';

  const amount = amountStr ? parseInt(amountStr, 10) : null;
  const pounds = amount
    ? (amount / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })
    : null;

  return (
    <Center mih="60vh">
      <Paper p="xl" radius="lg" withBorder maw={520} w="100%">
        <Stack gap="lg" align="center">
          <Center
            w={64}
            h={64}
            style={{ borderRadius: '50%', background: 'var(--mantine-color-green-1)' }}
          >
            <IconCheck size={32} color="var(--mantine-color-green-6)" />
          </Center>

          <Stack gap="xs" align="center">
            <Title order={2} ta="center">
              {isExisting ? 'Payment already set up' : 'Direct Debit set up successfully'}
            </Title>
            <Text c="dimmed" ta="center" size="sm">
              {isExisting
                ? 'This payment reference is already active — no duplicate subscription was created.'
                : 'The Direct Debit mandate and subscription have been created with GoCardless.'}
            </Text>
          </Stack>

          {hasWarning && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="orange"
              variant="light"
              radius="md"
              w="100%"
            >
              <Text size="sm">
                The mandate was created but the subscription could not be set up automatically.
                Please contact your club treasurer to complete the setup.
              </Text>
            </Alert>
          )}

          <Paper
            p="md"
            radius="md"
            w="100%"
            style={{ background: 'var(--mantine-color-gray-0)', border: '1px solid var(--mantine-color-gray-2)' }}
          >
            <Stack gap="xs">
              {ref && (
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Reference</Text>
                  <Code fw={700}>{ref}</Code>
                </Group>
              )}
              {pounds && !hasWarning && (
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Amount</Text>
                  <Text size="sm" fw={600}>{pounds} / {intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month'}</Text>
                </Group>
              )}
              {mandate && (
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>Mandate ID</Text>
                  <Code style={{ wordBreak: 'break-all' }}>{mandate}</Code>
                </Group>
              )}
              {subscription && !hasWarning && (
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>Subscription ID</Text>
                  <Code style={{ wordBreak: 'break-all' }}>{subscription}</Code>
                </Group>
              )}
              {isExisting && (
                <Group justify="center" mt="xs">
                  <Badge color="blue" variant="light">Subscription already active</Badge>
                </Group>
              )}
            </Stack>
          </Paper>

          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate('/')}
            radius="xl"
          >
            Back to home
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
