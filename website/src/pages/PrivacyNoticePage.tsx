import { useEffect, useState } from 'react';
import { Alert, Loader, Center, List, Stack, Text, Title, Paper } from '@mantine/core';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

type PrivacyNotice = {
  controller: {
    name: string;
    clubSlug: string;
    email: string | null;
    address: string | null;
  };
  processor: { name: string; role: string };
  purposes: Array<{ purpose: string; basis: string; notes: string }>;
  retention: Array<{ data: string; period: string }>;
  rights: string[];
  marketingConsent: string;
  icoFeeNote: string;
  generatedAt: string;
};

export function PrivacyNoticePage() {
  const { clubSlug } = useClub();
  const [notice, setNotice] = useState<PrivacyNotice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/privacy-notice', {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) throw new Error('Failed to load privacy notice');
        const data = await res.json() as PrivacyNotice;
        if (!cancelled) setNotice(data);
      } catch {
        if (!cancelled) setError('Could not load the privacy notice.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubSlug]);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Privacy notice"
        subtitle="Who holds your data, why, and your rights"
      />

      {loading && (
        <Center py="xl"><Loader /></Center>
      )}
      {error && <Alert color="red" variant="light">{error}</Alert>}

      {notice && (
        <Stack gap="md">
          <Paper p="lg" withBorder radius="md">
            <Title order={3} ff={clubDesign.font.heading} mb="sm">Data controller</Title>
            <Text fw={700}>{notice.controller.name}</Text>
            {notice.controller.email && <Text size="sm">Email: {notice.controller.email}</Text>}
            {notice.controller.address && <Text size="sm">Address: {notice.controller.address}</Text>}
            <Text size="sm" c="dimmed" mt="sm">
              Processor: {notice.processor.name}. {notice.processor.role}
            </Text>
          </Paper>

          <Paper p="lg" withBorder radius="md">
            <Title order={3} ff={clubDesign.font.heading} mb="sm">Purposes and lawful basis</Title>
            <Stack gap="sm">
              {notice.purposes.map((p) => (
                <div key={p.purpose}>
                  <Text fw={600} size="sm">{p.purpose}</Text>
                  <Text size="sm"><Text span fw={600}>Basis:</Text> {p.basis}</Text>
                  <Text size="sm" c="dimmed">{p.notes}</Text>
                </div>
              ))}
            </Stack>
          </Paper>

          <Paper p="lg" withBorder radius="md">
            <Title order={3} ff={clubDesign.font.heading} mb="sm">Retention</Title>
            <List size="sm">
              {notice.retention.map((r) => (
                <List.Item key={r.data}>
                  <Text span fw={600}>{r.data}:</Text> {r.period}
                </List.Item>
              ))}
            </List>
          </Paper>

          <Paper p="lg" withBorder radius="md">
            <Title order={3} ff={clubDesign.font.heading} mb="sm">Your rights</Title>
            <List size="sm">
              {notice.rights.map((r) => (
                <List.Item key={r}>{r}</List.Item>
              ))}
            </List>
            <Text size="sm" mt="md">{notice.marketingConsent}</Text>
          </Paper>

          <Paper p="lg" withBorder radius="md">
            <Title order={3} ff={clubDesign.font.heading} mb="sm">ICO data protection fee</Title>
            <Text size="sm">{notice.icoFeeNote}</Text>
            <Text size="xs" c="dimmed" mt="sm">
              Generated {new Date(notice.generatedAt).toLocaleString('en-GB')}
            </Text>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
