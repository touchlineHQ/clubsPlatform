import { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Code, Divider, Group,
  Loader, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import {
  IconAlertCircle, IconCheck, IconCopy,
  IconExternalLink, IconReceipt,
} from '@tabler/icons-react';
import { clubDesign } from '../../theme';
import {
  formatGBP, INTERVAL_OPTIONS, type IntervalUnit, type PlayerPaymentRow,
} from './types';
import { usePlayerRegistrationSearch } from './usePlayerRegistrationSearch';

interface Props {
  clubSlug: string | null;
  clubHeaders: HeadersInit;
}

export function PlayerSubscriptionsTab({ clubSlug, clubHeaders }: Props) {
  const search = usePlayerRegistrationSearch(clubHeaders);

  const [payments, setPayments] = useState<PlayerPaymentRow[]>([]);

  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);
  const [totalGbp, setTotalGbp] = useState<number | string>('');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('monthly');
  const [paymentCount, setPaymentCount] = useState<number | string>('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [autofilled, setAutofilled] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatedRef, setGeneratedRef] = useState('');
  const [copied, setCopied] = useState(false);

  // Players are searched rather than listed, so only the payments load here.
  // clubSlug is in the deps now: these never refetched when the club changed.
  useEffect(() => {
    fetch('/api/admin/player-payments', { headers: clubHeaders })
      .then(r => r.ok ? r.json() as Promise<{ payments: PlayerPaymentRow[] }> : Promise.reject())
      .then(d => setPayments(d.payments))
      .catch(() => { /* non-fatal */ });
  }, [clubSlug]);

  const selectedReg = search.selected;

  const publicUrl = selectedReg && clubSlug
    ? `${window.location.origin}/${clubSlug}/payments/SUBS/${selectedReg.fanId}`
    : null;

  const handleSelect = async (regId: string | null) => {
    setSelectedRegId(regId);
    setGeneratedLink('');
    setGeneratedRef('');
    setGenError('');

    // Awaited: a registration chosen from a search the user has since typed
    // past is fetched by id, and the pricing fields drive the autofill below.
    const reg = await search.select(regId);
    if (reg && reg.yearlyPriceInPence != null && reg.intervalCount != null && reg.intervalUnit) {
      setTotalGbp(reg.yearlyPriceInPence / 100);
      setIntervalUnit(reg.intervalUnit);
      setPaymentCount(reg.intervalCount);
      setStartDate(reg.startDate ?? null);
      setAutofilled(true);
    } else {
      setTotalGbp('');
      setPaymentCount('');
      setStartDate(null);
      setAutofilled(false);
    }
  };

  const existingForSelected = selectedRegId
    ? payments.filter(p => p.registrationId === selectedRegId && p.reference.includes('-SUBS'))
    : [];

  const totalNum = typeof totalGbp === 'string' ? parseFloat(totalGbp) : totalGbp;
  const countNum = typeof paymentCount === 'string' ? parseInt(paymentCount, 10) : paymentCount;
  const hasValidTotal = Number.isFinite(totalNum) && totalNum > 0;
  const hasValidCount = Number.isInteger(countNum) && countNum > 0;
  const perPaymentPence = hasValidTotal && hasValidCount
    ? Math.round((totalNum * 100) / countNum)
    : null;
  const canGenerate = !!selectedRegId && hasValidTotal && hasValidCount;

  const handleGenerate = async () => {
    if (!canGenerate || !selectedReg || perPaymentPence == null) return;
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
          paymentType: 'SUBS',
          amountInPence: perPaymentPence,
          intervalUnit,
          count: countNum,
          ...(startDate ? { startDate } : {}),
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

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Stack gap="lg">
      {/* The picker searches server-side now, so its failures are the only
          load errors this tab has left — and they have to be visible, or a
          failed query reads as "no such player". */}
      {search.error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
          {search.error}
        </Alert>
      )}

      {/* Step 1: pick player */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">1. Select a registration</Text>
          <Select
            placeholder="Search by FAN number or team…"
            data={search.options}
            value={selectedRegId}
            onChange={handleSelect}
            searchable
            clearable
            radius="md"
            searchValue={search.query}
            onSearchChange={search.setQuery}
            // The club is not loaded up front any more, so the list cannot be
            // narrowed locally — every keystroke is a query.
            filter={({ options }) => options}
            nothingFoundMessage={search.nothingFoundMessage}
            rightSection={search.searching ? <Loader size="xs" /> : undefined}
          />

          {selectedReg && (
            <Paper p="sm" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              <Group gap="sm" wrap="wrap">
                <Badge color="blue" variant="light">FAN {selectedReg.fanId}</Badge>
                <Badge color="gray" variant="light">{selectedReg.teamName}</Badge>
                {selectedReg.subscriptionLevelName && (
                  <Badge color="green" variant="light">Level: {selectedReg.subscriptionLevelName}</Badge>
                )}
              </Group>
            </Paper>
          )}

          {publicUrl && (
            <Paper p="sm" radius="sm" style={{ background: clubDesign.color.n1, border: `1px solid ${clubDesign.color.n3}` }}>
              <Stack gap={6}>
                <Text size="sm" fw={600}>Public payment link for this player</Text>
                <Group gap="xs" wrap="wrap" align="center">
                  <Code style={{ wordBreak: 'break-all', flex: 1, minWidth: 0 }}>{publicUrl}</Code>
                  <Tooltip label={copied ? 'Copied!' : 'Copy link'}>
                    <ActionIcon variant="subtle" onClick={() => copy(publicUrl)}>
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Text size="xs" c="dimmed">
                  If this player is on multiple teams at this club, opening this link shows a
                  team-selection page. For single-team players it redirects straight to GoCardless.
                  Only works once a subscription level is assigned to the team.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* Step 2: configure */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">2. Configure subscription</Text>

          {autofilled && selectedReg?.subscriptionLevelName && (
            <Alert color="blue" variant="light" radius="md">
              <Text size="sm">
                Auto-filled from team subscription level <strong>{selectedReg.subscriptionLevelName}</strong>{' '}
                ({selectedReg.intervalCount} × {selectedReg.intervalUnit} payments). Override below if needed.
              </Text>
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, xs: 2, sm: 2, md: 4 }} spacing="md" verticalSpacing="md">
            <NumberInput
              label="Total (£)"
              placeholder="e.g. 250"
              value={totalGbp}
              onChange={v => { setTotalGbp(v); setAutofilled(false); }}
              min={0}
              decimalScale={2}
              fixedDecimalScale={false}
              thousandSeparator=","
              prefix="£"
              radius="md"
            />
            <NumberInput
              label="Number of payments"
              placeholder="e.g. 10"
              value={paymentCount}
              onChange={v => { setPaymentCount(v); setAutofilled(false); }}
              min={1}
              max={200}
              radius="md"
            />
            <Select
              label="Interval"
              data={INTERVAL_OPTIONS}
              value={intervalUnit}
              onChange={v => { setIntervalUnit((v as IntervalUnit) ?? 'monthly'); setAutofilled(false); }}
              radius="md"
            />
            <DatePickerInput
              label="First payment date"
              placeholder="Pick a date"
              value={startDate}
              onChange={v => { setStartDate(v); setAutofilled(false); }}
              clearable
              radius="md"
              valueFormat="DD MMM YYYY"
            />
          </SimpleGrid>

          {perPaymentPence != null && (
            <Alert color="blue" variant="light" radius="md">
              <Text size="sm">
                Player pays <strong>{formatGBP(perPaymentPence)}</strong> per{' '}
                {intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month'} for{' '}
                <strong>{countNum}</strong> payment{countNum === 1 ? '' : 's'}.
              </Text>
            </Alert>
          )}

          {existingForSelected.length > 0 && (
            <Alert color="orange" variant="light" radius="md">
              <Text size="sm">
                This registration has {existingForSelected.length} existing payment record{existingForSelected.length !== 1 ? 's' : ''}.
                Generating a new link will add another attempt — if the player already has an active
                mandate, GoCardless will reuse it.
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
                <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{generatedLink}</Text>
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
