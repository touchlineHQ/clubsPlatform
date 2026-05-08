import { useSearchParams } from 'react-router-dom';
import {
  Alert, Badge, Button, Container, Divider, Group,
  Paper, Stack, Text, ThemeIcon, Title,
} from '@mantine/core';
import { IconCheck, IconAlertTriangle, IconReceipt } from '@tabler/icons-react';

function formatAmount(amountStr: string | null, intervalUnit: string | null): string {
  const pence = parseInt(amountStr ?? '', 10);
  if (isNaN(pence)) return '';
  const pounds = (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
  const freq = intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month';
  return `${pounds} / ${freq}`;
}

export function PaymentSuccessPage() {
  const [params] = useSearchParams();

  const mandateId = params.get('mandate');
  const subscriptionId = params.get('subscription');
  const reference = params.get('ref');
  const warning = params.get('warning');
  const existing = params.get('existing') === '1';
  const amountDisplay = formatAmount(params.get('amount'), params.get('interval_unit'));

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl" align="center">
        <ThemeIcon size={80} radius="xl" color="green.5" variant="light">
          <IconCheck size={48} />
        </ThemeIcon>

        <div>
          <Title order={1} ta="center" c="green.8">Payment Setup Complete</Title>
          <Text size="lg" c="dimmed" ta="center" mt="sm">
            Your Direct Debit mandate has been authorised.
          </Text>
        </div>

        {warning === 'subscription_failed' && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" radius="md" w="100%">
            <Text size="sm">
              Your mandate was authorised successfully, but there was an issue setting up the
              recurring subscription automatically. Your treasurer has been notified and will
              activate it shortly. Your reference is <strong>{reference}</strong>.
            </Text>
          </Alert>
        )}

        {!warning && subscriptionId && !existing && (
          <Alert icon={<IconReceipt size={16} />} color="green" variant="light" radius="md" w="100%">
            <Text size="sm">
              Your recurring subscription has been created. Payments will be collected automatically
              and will appear on your bank statement with the reference below.
            </Text>
          </Alert>
        )}

        {existing && subscriptionId && (
          <Alert icon={<IconReceipt size={16} />} color="blue" variant="light" radius="md" w="100%">
            <Text size="sm">
              This subscription is already active — no further action needed.
            </Text>
          </Alert>
        )}

        <Paper p="xl" radius="lg" withBorder style={{ width: '100%' }}>
          <Stack gap="md">
            {reference && (
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Payment Reference</Text>
                <Badge size="lg" variant="light" color="green">{reference}</Badge>
              </Group>
            )}
            {amountDisplay && (
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Amount</Text>
                <Text size="sm" fw={600}>{amountDisplay}</Text>
              </Group>
            )}
            {(mandateId || subscriptionId) && <Divider />}
            {mandateId && (
              <Group justify="space-between" wrap="nowrap" gap="xl">
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>Mandate ID</Text>
                <Text size="sm" fw={500} ff="monospace" style={{ wordBreak: 'break-all', textAlign: 'right' }}>
                  {mandateId}
                </Text>
              </Group>
            )}
            {subscriptionId && (
              <Group justify="space-between" wrap="nowrap" gap="xl">
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>Subscription ID</Text>
                <Text size="sm" fw={500} ff="monospace" style={{ wordBreak: 'break-all', textAlign: 'right' }}>
                  {subscriptionId}
                </Text>
              </Group>
            )}
          </Stack>
        </Paper>

        <Button component="a" href="/" color="green.6" size="lg" radius="xl">
          Return to Home
        </Button>
      </Stack>
    </Container>
  );
}
