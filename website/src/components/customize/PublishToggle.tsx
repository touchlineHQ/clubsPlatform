import { useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconEye, IconEyeOff, IconWorld } from '@tabler/icons-react';
import { useClub } from '../../context/ClubContext';
import { captureError, captureEvent } from '../../lib/posthog';

interface Props {
  published: boolean;
  onPublishedChange: (published: boolean) => void;
}

/**
 * Go-live control for the club's public site.
 *
 * Deliberately separate from "Save to Site": saving content and deciding the
 * world can see it are different decisions, and a club part-way through
 * onboarding will save many times before it wants either.
 *
 * The confirmation is inline rather than a Mantine Modal — a Modal pulls in
 * react-remove-scroll, which resolves a second copy of React under the repo's
 * vitest setup and cannot be rendered in a test.
 */
export function PublishToggle({ published, onPublishedChange }: Props) {
  const { clubSlug } = useClub();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = !published;

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/clubs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ published: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed to update: ${res.status}`);
      }
      // Written out rather than as a ternary so scripts/posthog-events.mjs can
      // see both literals and keep .posthog-events.json honest.
      if (next) captureEvent('club published', { club_slug: clubSlug });
      else captureEvent('club unpublished', { club_slug: clubSlug });
      onPublishedChange(next);
      setConfirming(false);
    } catch (e) {
      captureError(e, { op: 'club.publish', club_slug: clubSlug });
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Alert
      variant="light"
      color={published ? 'green' : 'orange'}
      radius="md"
      icon={published ? <IconWorld size={18} /> : <IconEyeOff size={18} />}
    >
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={700} size="sm">Site visibility</Text>
            <Badge size="sm" variant="filled" color={published ? 'green' : 'orange'}>
              {published ? 'Live' : 'Private'}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {published
              ? 'Anyone can see your club pages.'
              : "Only your club's admins can see your pages. Registration and payment links keep working either way."}
          </Text>
        </Stack>

        {confirming ? (
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" fw={600}>
              {published ? 'Hide the site from everyone but admins?' : 'Make your pages visible to everyone?'}
            </Text>
            <Button size="compact-sm" radius="xl" variant="subtle" color="gray" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="compact-sm" radius="xl" color={published ? 'orange' : 'green'} loading={saving} onClick={apply}>
              {published ? 'Yes, make private' : 'Yes, go live'}
            </Button>
          </Group>
        ) : (
          <Button
            radius="xl"
            color={published ? 'gray' : 'green'}
            variant={published ? 'default' : 'filled'}
            leftSection={published ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            onClick={() => setConfirming(true)}
          >
            {published ? 'Make private' : 'Go live'}
          </Button>
        )}
      </Group>
      {error && <Text size="xs" c="red" mt="xs">{error}</Text>}
    </Alert>
  );
}
