import { useState } from 'react';
import { Alert, Stack, Tabs, Text } from '@mantine/core';
import { IconCash, IconReceipt, IconShield, IconUserDollar } from '@tabler/icons-react';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { SubscriptionLevelsTab } from './admin-payments/SubscriptionLevelsTab';
import { PlayerSubscriptionsTab } from './admin-payments/PlayerSubscriptionsTab';
import { PaymentRecordsTab } from './admin-payments/PaymentRecordsTab';

type TabId = 'levels' | 'subs' | 'records';

export function AdminPaymentsPage() {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug } as HeadersInit;
  const [tab, setTab] = useState<TabId>('levels');

  return (
    <Stack maw={1100} mx="auto" gap="lg" px={{ base: 'xs', sm: 0 }}>
      <PageHeader
        title="Payments"
        subtitle="Subscription levels and player subscriptions — all powered by GoCardless"
      />

      <Alert icon={<IconShield size={16} />} color="green" variant="light" radius="md">
        <Text size="sm">
          <strong>GDPR Compliant:</strong> No payment data is stored locally beyond mandate and
          subscription IDs. References use only FA Numbers. Links are single-use and expire once
          the player completes setup.
        </Text>
      </Alert>

      <Tabs
        value={tab}
        onChange={(v) => setTab((v as TabId) ?? 'levels')}
        radius="md"
        variant="outline"
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="levels" leftSection={<IconCash size={14} />}>
            Subscription Levels
          </Tabs.Tab>
          <Tabs.Tab value="subs" leftSection={<IconUserDollar size={14} />}>
            Player Subscriptions
          </Tabs.Tab>
          <Tabs.Tab value="records" leftSection={<IconReceipt size={14} />}>
            Payment Records
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="levels" pt="lg">
          <SubscriptionLevelsTab clubHeaders={clubHeaders} />
        </Tabs.Panel>

        <Tabs.Panel value="subs" pt="lg">
          <PlayerSubscriptionsTab clubSlug={clubSlug} clubHeaders={clubHeaders} />
        </Tabs.Panel>

        <Tabs.Panel value="records" pt="lg">
          <PaymentRecordsTab clubHeaders={clubHeaders} />
        </Tabs.Panel>

      </Tabs>
    </Stack>
  );
}
