import { useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Center, Code, Divider, Group,
  Loader, Paper, Select, Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle, IconAlertTriangle, IconCheck, IconCopy,
  IconExternalLink, IconReceipt, IconShield,
} from '@tabler/icons-react';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null;
}

interface PlayerPaymentRow {
  id: string;
  registrationId: string;
  fanId: string;
  teamName: string;
  reference: string;
  mandateId: string;
  subscriptionId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

const PAYMENT_TYPES = [
  { value: 'SUBS', label: 'Subscription Fees' },
  { value: 'TOUR', label: 'Tournament Fees' },
  { value: 'KIT', label: 'Kit Payment' },
  { value: 'EVENT', label: 'Event Ticket' },
  { value: 'OTHER', label: 'Other' },
];

const INTERVAL_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
];


export function AdminPaymentsPage() {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug } as HeadersInit;

  const [registrations, setRegistrations] = useState<PlayerRegistrationRow[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [payments, setPayments] = useState<PlayerPaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  // Selection keyed by registrationId so players on multiple teams get separate options
  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState('SUBS');
  const [amountGbp, setAmountGbp] = useState('');
  const [intervalUnit, setIntervalUnit] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatedRef, setGeneratedRef] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/admin/player-registrations', { headers: clubHeaders })
      .then(r => r.ok ? r.json() as Promise<{ registrations: PlayerRegistrationRow[] }> : Promise.reject())
      .then(d => setRegistrations(d.registrations))
      .catch(() => setLoadError('Failed to load player registrations.'))
      .finally(() => setLoadingPlayers(false));

    fetch('/api/admin/player-payments', { headers: clubHeaders })
      .then(r => r.ok ? r.json() as Promise<{ payments: PlayerPaymentRow[] }> : Promise.reject())
      .then(d => setPayments(d.payments))
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoadingPayments(false));
  }, []);

  // Each registration is its own option — a player on two teams gets two rows
  const playerOptions = registrations.map(r => ({
    value: r.registrationId,
    label: `FAN ${r.fanId} — ${r.teamName}${r.ageGroup ? ` (${r.ageGroup})` : ''}`,
  }));

  const selectedReg = registrations.find(r => r.registrationId === selectedRegId) ?? null;

  const handleSelect = (regId: string | null) => {
    setSelectedRegId(regId);
    setGeneratedLink('');
    setGeneratedRef('');
    setGenError('');
  };

  // Existing payment records for this registration + payment type
  const existingForSelected = selectedRegId
    ? payments.filter(p => p.registrationId === selectedRegId && p.reference.endsWith(`-${paymentType}`))
    : [];

  const amountValid = () => {
    const n = parseFloat(amountGbp);
    return !isNaN(n) && n > 0;
  };

  const canGenerate = !!selectedRegId && amountValid();

  const handleGenerate = async () => {
    if (!canGenerate || !selectedReg) return;
    setGenerating(true);
    setGenError('');
    setGeneratedLink('');
    setGeneratedRef('');

    try {
      const res = await fetch('/api/gocardless/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({
          registrationId: selectedRegId,
          paymentType,
          amountInPence: Math.round(parseFloat(amountGbp) * 100),
          intervalUnit,
        }),
      });

      const data = await res.json() as { authorisation_url?: string; reference?: string; error?: string };
      if (!res.ok || !data.authorisation_url) {
        setGenError(data.error ?? 'Failed to generate payment link. Is the GC_ACCESS_TOKEN secret set?');
        return;
      }

      setGeneratedLink(data.authorisation_url);
      setGeneratedRef(data.reference ?? '');
    } catch {
      setGenError('Network error. Please check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Stack maw={900} mx="auto" gap="lg">
      <PageHeader
        title="Payment Links"
        subtitle="Generate a GoCardless Direct Debit link for a registered player"
      />

      <Alert icon={<IconShield size={16} />} color="green" variant="light" radius="md">
        <Text size="sm">
          <strong>GDPR Compliant:</strong> No payment data is stored locally beyond mandate and
          subscription IDs. References use only FA Numbers. Links are single-use and expire once
          the player completes setup.
        </Text>
      </Alert>

      {loadError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
          {loadError}
        </Alert>
      )}

      {/* ── Step 1: Pick registration ── */}
      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">1. Select a registration</Text>

          {loadingPlayers ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : registrations.length === 0 ? (
            <Box p="md" style={{ background: clubDesign.color.n1, border: `1px dashed ${clubDesign.color.n3}`, borderRadius: 8 }}>
              <Text size="sm" c="dimmed" ta="center">
                No registered players found. Import players first via Admin → Import.
              </Text>
            </Box>
          ) : (
            <Select
              placeholder="Search by FAN number or team…"
              data={playerOptions}
              value={selectedRegId}
              onChange={handleSelect}
              searchable
              clearable
              radius="md"
              nothingFoundMessage="No players match your search"
            />
          )}

          {selectedReg && (
            <Paper p="sm" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              <Group gap="sm" wrap="wrap">
                <Badge color="blue" variant="light">FAN {selectedReg.fanId}</Badge>
                <Badge color="gray" variant="light">{selectedReg.teamName}</Badge>
                {selectedReg.ageGroup && <Badge color="gray" variant="outline">{selectedReg.ageGroup}</Badge>}
                {selectedReg.registrationStatus && (
                  <Badge
                    color={selectedReg.registrationStatus.toLowerCase() === 'registered' ? 'green' : 'orange'}
                    variant="light"
                  >
                    {selectedReg.registrationStatus}
                  </Badge>
                )}
              </Group>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* ── Step 2: Configure payment ── */}
      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">2. Configure payment</Text>

          <Group grow align="flex-start" wrap="wrap">
            <Select
              label="Payment type"
              data={PAYMENT_TYPES}
              value={paymentType}
              onChange={v => { setPaymentType(v ?? 'SUBS'); setGeneratedLink(''); setGeneratedRef(''); }}
              radius="md"
            />
            <TextInput
              label="Amount (£)"
              placeholder="e.g. 25.00"
              value={amountGbp}
              onChange={e => setAmountGbp(e.target.value)}
              radius="md"
              leftSection={<Text size="sm" c="dimmed">£</Text>}
            />
            <Select
              label="Interval"
              data={INTERVAL_OPTIONS}
              value={intervalUnit}
              onChange={v => setIntervalUnit((v as 'monthly' | 'weekly' | 'yearly') ?? 'monthly')}
              radius="md"
            />
          </Group>

          {existingForSelected.length > 0 && (
            <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light" radius="md">
              <Text size="sm" fw={600} mb={4}>
                This registration already has a {paymentType} payment record:
              </Text>
              {existingForSelected.map(p => (
                <Text key={p.id} size="sm">
                  Reference <Code>{p.reference}</Code>
                  {' — '}{p.status === 'active' ? 'active subscription' : 'mandate only (no subscription)'}
                  {p.subscriptionId && <> · Sub ID: <Code>{p.subscriptionId}</Code></>}
                </Text>
              ))}
              <Text size="sm" mt={4} c="dimmed">
                Generating a new link may result in a duplicate. GoCardless will reuse the
                existing subscription if the mandate matches.
              </Text>
            </Alert>
          )}

          {genError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
              {genError}
            </Alert>
          )}

          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            leftSection={generating ? <Loader size={14} color="white" /> : <IconReceipt size={18} />}
            radius="xl"
            size="md"
          >
            {generating ? 'Generating…' : 'Generate Payment Link'}
          </Button>
        </Stack>
      </Paper>

      {/* ── Step 3: Share link ── */}
      {generatedLink && (
        <Paper p="lg" withBorder radius="md">
          <Stack gap="md">
            <Divider />
            <Text fw={700} ff={clubDesign.font.heading} fz="md">3. Share with player</Text>

            <Paper p="md" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Reference</Text>
                  <Code fw={700}>{generatedRef}</Code>
                </Group>
                <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{generatedLink}</Text>
              </Stack>
            </Paper>

            <Group>
              <Button
                variant="light"
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={copyLink}
                radius="xl"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </Button>
              <Button
                component="a"
                href={generatedLink}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                leftSection={<IconExternalLink size={16} />}
                radius="xl"
              >
                Open Payment Page
              </Button>
            </Group>

            <Alert icon={<IconReceipt size={16} />} color="blue" variant="light" radius="md">
              <Text size="sm">
                Send this link to the player or parent. When they complete Direct Debit setup their
                mandate and {intervalUnit} subscription will be created automatically. Bank
                statements will show <Code>{generatedRef}</Code> as the reference.
              </Text>
            </Alert>
          </Stack>
        </Paper>
      )}

      {/* ── Existing payment records ── */}
      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">Payment records</Text>
          <Text size="sm" c="dimmed">
            Mandates and subscriptions recorded after players complete the GoCardless payment flow.
          </Text>

          {loadingPayments ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : payments.length === 0 ? (
            <Box p="xl" style={{ background: clubDesign.color.n1, border: `1px dashed ${clubDesign.color.n3}`, borderRadius: 8, textAlign: 'center' }}>
              <Text size="sm" c="dimmed">No payment records yet. They appear here once players complete setup.</Text>
            </Box>
          ) : (
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>FAN</Table.Th>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Reference</Table.Th>
                    <Table.Th>Mandate ID</Table.Th>
                    <Table.Th>Subscription ID</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Date</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {payments.map(p => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        <Text size="sm" ff="monospace" fw={600}>{p.fanId}</Text>
                      </Table.Td>
                      <Table.Td><Text size="sm">{p.teamName}</Text></Table.Td>
                      <Table.Td>
                        <Tooltip label={p.reference} withArrow>
                          <Text size="sm" ff="monospace" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.reference}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={p.mandateId} withArrow>
                          <Text size="xs" ff="monospace" c="dimmed" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.mandateId}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {p.subscriptionId ? (
                          <Tooltip label={p.subscriptionId} withArrow>
                            <Text size="xs" ff="monospace" c="dimmed" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.subscriptionId}
                            </Text>
                          </Tooltip>
                        ) : (
                          <Text size="xs" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" color={p.status === 'active' ? 'green' : 'orange'} variant="light">
                          {p.status === 'active' ? 'Active' : 'Mandate only'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {new Date(p.createdAt).toLocaleDateString('en-GB')}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
