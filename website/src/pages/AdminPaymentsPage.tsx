import { useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Center, Code, Divider, Group,
  Loader, Paper, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import {
  IconAlertCircle, IconCheck, IconCopy, IconExternalLink,
  IconReceipt, IconShield,
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

  const [selectedFan, setSelectedFan] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState('');
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
  }, []);

  const playerOptions = registrations.map(r => ({
    value: r.fanId,
    label: `FAN ${r.fanId} — ${r.teamName}${r.ageGroup ? ` (${r.ageGroup})` : ''}`,
  }));

  const handlePlayerSelect = (fanId: string | null) => {
    setSelectedFan(fanId);
    setGeneratedLink('');
    setGeneratedRef('');
    setGenError('');
    if (fanId) {
      const reg = registrations.find(r => r.fanId === fanId);
      setSelectedTeam(reg?.teamName ?? '');
    } else {
      setSelectedTeam('');
    }
  };

  const amountValid = () => {
    const n = parseFloat(amountGbp);
    return !isNaN(n) && n > 0;
  };

  const canGenerate = selectedFan && selectedTeam && amountValid();

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setGenError('');
    setGeneratedLink('');
    setGeneratedRef('');

    try {
      const amount = parseFloat(amountGbp);
      const res = await fetch('/api/gocardless/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({
          team: selectedTeam,
          fan: selectedFan,
          paymentType,
          amountInPence: Math.round(amount * 100),
          intervalUnit,
          description: `${selectedTeam.toUpperCase()} ${paymentType} - FAN ${selectedFan}`,
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
    <Stack maw={860} mx="auto" gap="lg">
      <PageHeader
        title="Payment Links"
        subtitle="Generate a GoCardless Direct Debit link for a registered player"
      />

      <Alert icon={<IconShield size={16} />} color="green" variant="light" radius="md">
        <Text size="sm">
          <strong>GDPR Compliant:</strong> No payment data is stored locally. References use only
          FA Numbers. Links are single-use and expire once the player completes setup.
        </Text>
      </Alert>

      {loadError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
          {loadError}
        </Alert>
      )}

      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">1. Select a registered player</Text>

          {loadingPlayers ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : registrations.length === 0 ? (
            <Box
              p="md"
              style={{
                background: clubDesign.color.n1,
                border: `1px dashed ${clubDesign.color.n3}`,
                borderRadius: 8,
              }}
            >
              <Text size="sm" c="dimmed" ta="center">
                No registered players found. Import players first via Admin → Import.
              </Text>
            </Box>
          ) : (
            <Select
              placeholder="Search by FAN number or team…"
              data={playerOptions}
              value={selectedFan}
              onChange={handlePlayerSelect}
              searchable
              clearable
              radius="md"
              nothingFoundMessage="No players match your search"
            />
          )}

          {selectedFan && (
            <Paper p="sm" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              {(() => {
                const reg = registrations.find(r => r.fanId === selectedFan);
                if (!reg) return null;
                return (
                  <Group gap="sm" wrap="wrap">
                    <Badge color="blue" variant="light">FAN {reg.fanId}</Badge>
                    <Badge color="gray" variant="light">{reg.teamName}</Badge>
                    {reg.ageGroup && <Badge color="gray" variant="outline">{reg.ageGroup}</Badge>}
                    {reg.registrationStatus && (
                      <Badge
                        color={reg.registrationStatus.toLowerCase() === 'registered' ? 'green' : 'orange'}
                        variant="light"
                      >
                        {reg.registrationStatus}
                      </Badge>
                    )}
                  </Group>
                );
              })()}
            </Paper>
          )}
        </Stack>
      </Paper>

      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">2. Configure payment</Text>

          <Group grow align="flex-start" wrap="wrap">
            <Select
              label="Payment type"
              data={PAYMENT_TYPES}
              value={paymentType}
              onChange={v => setPaymentType(v ?? 'SUBS')}
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

      {generatedLink && (
        <Paper p="lg" withBorder radius="md">
          <Stack gap="md">
            <Divider />
            <Text fw={700} ff={clubDesign.font.heading} fz="md">3. Share with player</Text>

            <Paper
              p="md"
              radius="sm"
              style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}
            >
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Reference</Text>
                  <Code fw={700}>{generatedRef}</Code>
                </Group>
                <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                  {generatedLink}
                </Text>
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
                Send this link to the player or parent. When they complete Direct Debit setup
                their mandate and {intervalUnit} subscription will be created automatically.
                Bank statements will show <Code>{generatedRef}</Code> as the reference.
              </Text>
            </Alert>
          </Stack>
        </Paper>
      )}

      <Paper p="lg" withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">All registered players</Text>
          {loadingPlayers ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : registrations.length === 0 ? (
            <Text size="sm" c="dimmed">No players found.</Text>
          ) : (
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>FAN</Table.Th>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Age Group</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {registrations.map(reg => (
                    <Table.Tr
                      key={reg.registrationId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handlePlayerSelect(reg.fanId)}
                    >
                      <Table.Td>
                        <Text size="sm" ff="monospace" fw={600}>{reg.fanId}</Text>
                      </Table.Td>
                      <Table.Td><Text size="sm">{reg.teamName}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{reg.ageGroup ?? '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        {reg.registrationStatus ? (
                          <Badge
                            size="sm"
                            color={reg.registrationStatus.toLowerCase() === 'registered' ? 'green' : 'orange'}
                            variant="light"
                          >
                            {reg.registrationStatus}
                          </Badge>
                        ) : (
                          <Text size="sm" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="subtle"
                          radius="xl"
                          onClick={e => { e.stopPropagation(); handlePlayerSelect(reg.fanId); }}
                        >
                          Select
                        </Button>
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
