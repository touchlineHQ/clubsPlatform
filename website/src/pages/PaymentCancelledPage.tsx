import { useSearchParams } from 'react-router-dom';
import { Button, Code, Container, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

const REASON_LABELS: Record<string, string> = {
  missing_params:    'Required payment parameters were missing from the link.',
  invalid_amount:    'The payment amount was invalid.',
  token_missing:     'The club has not connected its GoCardless account yet. Ask your club admin to set GC_ACCESS_TOKEN in Admin → API Secrets.',
  fetch_failed:      'Could not retrieve the payment request from GoCardless.',
  fulfil_failed:     'The payment authorisation could not be completed.',
  no_mandate:        'No bank account mandate was found after authorisation.',
  no_level:          'No subscription level has been assigned to this team. Ask your club admin to set one in Admin → Payments → Subscription Levels.',
  gocardless_error:  'GoCardless rejected the request. The club\'s API token may be invalid or for the wrong environment.',
  player_not_found:  'No registration could be found for this FAN at this club.',
  invalid_link:      'This payment link is invalid or has expired.',
  invalid_url:       'The payment link is malformed.',
  invalid_reg:       'The selected registration does not belong to this player at this club.',
  unknown_club:      'This club could not be found.',
  unsupported_type:  'This payment type is not supported.',
  legacy_link:       'This payment link is from an older version and cannot be completed. Please request a new one.',
  link_failed:       'We could not start the payment flow. Please contact your club admin with the diagnostic code below.',
};

export function PaymentCancelledPage() {
  const [params] = useSearchParams();

  const reason = params.get('reason');
  const code = params.get('code');
  const detail = params.get('detail');
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

        {(code || detail) && (
          <Stack gap={4} align="center">
            {code && (
              <Text size="xs" c="dimmed">
                Diagnostic code: <Code>{reason ?? 'error'}/{code}</Code>
              </Text>
            )}
            {detail && (
              <Text size="xs" c="dimmed" ta="center" style={{ maxWidth: 480, wordBreak: 'break-word' }}>
                {detail}
              </Text>
            )}
          </Stack>
        )}

        <Text size="sm" c="dimmed" ta="center">
          If you'd like to set up your subscription, contact your club treasurer for a new payment link.
        </Text>

        <Button component="a" href="/" color="green.6" size="lg" radius="xl">
          Return to Home
        </Button>
      </Stack>
    </Container>
  );
}
