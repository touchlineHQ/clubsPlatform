import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Container, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

const REASON_LABELS: Record<string, string> = {
  missing_params:  'Required payment parameters were missing from the link.',
  invalid_amount:  'The payment amount was invalid.',
  token_missing:   'The payment integration is not configured. Please contact your club.',
  fetch_failed:    'Could not retrieve the payment request from GoCardless.',
  fulfil_failed:   'The payment authorisation could not be completed.',
  no_mandate:      'No bank account mandate was found after authorisation.',
};

export function PaymentCancelledPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const reason = params.get('reason');
  const reasonLabel = reason ? (REASON_LABELS[reason] ?? `Error: ${reason.replace(/_/g, ' ')}`) : null;

  const isError = reason && reason !== 'user_cancelled';

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl" align="center">
        <ThemeIcon size={80} radius="xl" color="gray" variant="light">
          <IconX size={48} />
        </ThemeIcon>

        <div>
          <Title order={1} ta="center" c="dimmed">
            {isError ? 'Payment Setup Failed' : 'Payment Not Completed'}
          </Title>
          <Text size="lg" c="dimmed" ta="center" mt="sm">
            {isError
              ? 'There was a problem setting up your Direct Debit. No mandate or payment has been created.'
              : 'You cancelled the payment process. No mandate or payment has been set up.'}
          </Text>
        </div>

        {reasonLabel && (
          <Text size="sm" c="dimmed" ta="center">
            {reasonLabel}
          </Text>
        )}

        <Text size="sm" c="dimmed" ta="center">
          If you'd like to set up your subscription, contact your club treasurer for a new payment link.
        </Text>

        <Button color="green.6" size="lg" radius="xl" onClick={() => navigate('/')}>
          Return to Home
        </Button>
      </Stack>
    </Container>
  );
}
