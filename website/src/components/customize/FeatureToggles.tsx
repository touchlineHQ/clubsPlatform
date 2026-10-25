import { useEffect, useState } from 'react';
import { Alert, Group, Paper, Stack, Switch, Text } from '@mantine/core';
import { useClub } from '../../context/ClubContext';
import { captureError, captureEvent } from '../../lib/posthog';

interface Props {
  pitchBookings: boolean;
  onFeaturesChange: (features: { pitchBookings: boolean }) => void;
}

/**
 * Club admin switches for optional features (#83). Today that is pitch
 * bookings: the Pitch Schedule, Request a Pitch and Booking Requests sidebar
 * items. The setting is this club's only; other clubs on the platform keep theirs.
 */
export function FeatureToggles({ pitchBookings, onFeaturesChange }: Props) {
  const { clubSlug } = useClub();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killed, setKilled] = useState(false);

  useEffect(() => {
    fetch('/api/club-features', { headers: { 'X-Club-Slug': clubSlug } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { killed?: { pitchBookings?: boolean } } | null) => setKilled(!!d?.killed?.pitchBookings))
      .catch(() => setKilled(false));
  }, [clubSlug]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/club-features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ feature: 'pitchBookings', enabled }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string; features?: { pitchBookings: boolean } };
      if (!res.ok || !d.features) throw new Error(d.error ?? `Failed to update: ${res.status}`);
      captureEvent('club feature toggled', { club_slug: clubSlug, feature: 'pitchBookings', enabled });
      onFeaturesChange(d.features);
    } catch (e) {
      captureError(e, { op: 'club.feature', club_slug: clubSlug });
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack gap="xs">
        <Text fw={700} size="sm">Features</Text>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <Text size="sm">Pitch bookings</Text>
            <Text size="xs" c="dimmed">
              {killed
                ? 'Turned off for the whole platform, so it cannot be enabled here.'
                : 'Adds Pitch Schedule, Request a Pitch and Booking Requests to the sidebar for this club only.'}
            </Text>
          </Stack>
          <Switch
            aria-label="Pitch bookings"
            checked={pitchBookings}
            disabled={saving || (killed && !pitchBookings)}
            onChange={e => toggle(e.currentTarget.checked)}
          />
        </Group>
        {error && <Alert color="red" variant="light">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
