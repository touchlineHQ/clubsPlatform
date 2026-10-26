import { useEffect, useRef, useState } from 'react';
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
  // The switch stays disabled until GET succeeds: until then we don't know
  // whether the platform has the feature killed, or what this club has stored.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onChangeRef = useRef(onFeaturesChange);
  // Update after commit (not during render), and before the GET effect below.
  useEffect(() => {
    onChangeRef.current = onFeaturesChange;
  }, [onFeaturesChange]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    fetch('/api/club-features', { headers: { 'X-Club-Slug': clubSlug } })
      .then(async r => {
        if (!r.ok) throw new Error(`Failed to load features: ${r.status}`);
        return r.json() as Promise<{ features?: { pitchBookings: boolean }; killed?: { pitchBookings?: boolean } }>;
      })
      .then(d => {
        if (cancelled) return;
        setKilled(!!d.killed?.pitchBookings);
        // Show the club's current setting, not the registry's possibly stale copy.
        if (d.features) onChangeRef.current(d.features);
        setLoaded(true);
      })
      .catch(e => {
        if (cancelled) return;
        captureError(e, { op: 'club.feature.load', club_slug: clubSlug });
        setLoadError('Could not load this club\'s feature settings. Reload the page to try again.');
      });
    return () => { cancelled = true; };
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
            disabled={!loaded || saving || (killed && !pitchBookings)}
            onChange={e => toggle(e.currentTarget.checked)}
          />
        </Group>
        {loadError && <Alert color="red" variant="light">{loadError}</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
