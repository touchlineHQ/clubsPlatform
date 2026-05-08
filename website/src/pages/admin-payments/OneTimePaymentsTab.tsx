import { useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Center, Code, Divider, Group,
  Loader, Paper, Select, SimpleGrid, Stack, Text, TextInput,
} from '@mantine/core';
import {
  IconAlertCircle, IconCheck, IconCopy,
  IconExternalLink, IconReceipt,
} from '@tabler/icons-react';
import { clubDesign } from '../../theme';
import { ONE_TIME_TYPES, type PlayerRegistrationRow } from './types';

interface Props {
  clubHeaders: HeadersInit;
}

export function OneTimePaymentsTab({ clubHeaders }: Props) {
  const [registrations, setRegistrations] = useState<PlayerRegistrationRow[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState<string>('KIT');
  const [amountGbp, setAmountGbp] = useState('');
  const [description, setDescription] = useState('');

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
    value: r.registrationId,
    label: `FAN ${r.fanId} — ${r.teamName}${r.ageGroup ? ` (${r.ageGroup})` : ''}`,
  }));
  const selectedReg = registrations.find(r => r.registrationId === selectedRegId) ?? null;

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
          intervalUnit: 'monthly',
          count: 1,
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      const data = await res.json() as { authorisation_url?: string; reference?: string; error?: string };
      if (!res.ok || !data.authorisation_url) {
        setGenError(data.error ?? 'Failed to generate payment link.');
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

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Stack gap="lg">
      <Alert color="blue" variant="light" radius="md">
        <Text size="sm">
          One-time payments use the same Direct Debit mandate flow but settle as a single payment.
          Use this for kit fees, tournaments, ad-hoc events.
        </Text>
      </Alert>

      {loadError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
          {loadError}
        </Alert>
      )}

      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">1. Select a registration</Text>
          {loadingPlayers ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : (
            <Select
              placeholder="Search by FAN number or team…"
              data={playerOptions}
              value={selectedRegId}
              onChange={(v) => { setSelectedRegId(v); setGeneratedLink(''); setGenError(''); }}
              searchable
              clearable
              radius="md"
              nothingFoundMessage="No players match your search"
            />
          )}
          {selectedReg && (
            <Group gap="sm" wrap="wrap">
              <Badge color="blue" variant="light">FAN {selectedReg.fanId}</Badge>
              <Badge color="gray" variant="light">{selectedReg.teamName}</Badge>
              {selectedReg.ageGroup && <Badge color="gray" variant="outline">{selectedReg.ageGroup}</Badge>}
            </Group>
          )}
        </Stack>
      </Paper>

      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">2. Configure one-off payment</Text>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label="Payment type"
              data={ONE_TIME_TYPES.map(t => ({ value: t.value, label: t.label }))}
              value={paymentType}
              onChange={v => setPaymentType(v ?? 'KIT')}
              radius="md"
            />
            <TextInput
              label="Amount (£)"
              placeholder="e.g. 45.00"
              value={amountGbp}
              onChange={e => setAmountGbp(e.target.value)}
              radius="md"
              leftSection={<Text size="sm" c="dimmed">£</Text>}
            />
          </SimpleGrid>

          <TextInput
            label="Description (optional)"
            placeholder="e.g. Away kit 2026"
            value={description}
            onChange={e => setDescription(e.target.value)}
            radius="md"
          />

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
            {generating ? 'Generating…' : 'Generate One-time Link'}
          </Button>
        </Stack>
      </Paper>

      {generatedLink && (
        <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
          <Stack gap="md">
            <Divider />
            <Text fw={700} ff={clubDesign.font.heading} fz="md">3. Share with player</Text>
            <Paper p="md" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              <Stack gap="xs">
                <Group justify="space-between" wrap="wrap">
                  <Text size="sm" c="dimmed">Reference</Text>
                  <Code fw={700}>{generatedRef}</Code>
                </Group>
                <Box style={{ wordBreak: 'break-all' }}>
                  <Text size="sm" c="dimmed">{generatedLink}</Text>
                </Box>
              </Stack>
            </Paper>
            <Group wrap="wrap">
              <Button
                variant="light"
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={() => copy(generatedLink)}
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
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
