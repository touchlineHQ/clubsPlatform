import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Center, Paper, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconX } from '@tabler/icons-react';

export function PaymentCancelledPage() {
  const navigate = useNavigate();
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    setReason(params.get('reason'));
  }, []);

  return (
    <Center mih="60vh">
      <Paper p="xl" radius="lg" withBorder maw={480} w="100%">
        <Stack gap="lg" align="center">
          <Center
            w={64}
            h={64}
            style={{ borderRadius: '50%', background: 'var(--mantine-color-red-1)' }}
          >
            <IconX size={32} color="var(--mantine-color-red-6)" />
          </Center>

          <Stack gap="xs" align="center">
            <Title order={2} ta="center">Payment setup cancelled</Title>
            <Text c="dimmed" ta="center" size="sm">
              No Direct Debit was set up. If you'd like to complete the payment,
              please ask your club treasurer for a new payment link.
            </Text>
            {reason && (
              <Text c="dimmed" ta="center" size="xs" mt="xs">
                Reason: <em>{reason.replace(/_/g, ' ')}</em>
              </Text>
            )}
          </Stack>

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
