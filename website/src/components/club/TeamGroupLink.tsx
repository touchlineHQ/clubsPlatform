import { useEffect, useState } from 'react';
import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useClub } from '../../context/ClubContext';

interface Props {
  slug: string;
  league: string;
  /** Club content editors can set the link as well as see it. */
  canEdit: boolean;
}

/**
 * The team's WhatsApp group invite (#74). The server only answers someone
 * assigned to the team or a content editor; the caller decides whether to
 * mount this at all, so signed-out visitors never trigger the request.
 */
export function TeamGroupLink({ slug, league, canEdit }: Props) {
  const { clubSlug } = useClub();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams({ slug, league }).toString();

  useEffect(() => {
    fetch(`/api/team-group-link?${qs}`, { headers: { 'X-Club-Slug': clubSlug } })
      .then(r => (r.ok ? r.json() : { url: undefined }))
      .then((d: { url?: string | null }) => {
        setUrl(d.url);
        setDraft(d.url ?? '');
      })
      .catch(() => setUrl(undefined));
  }, [qs, clubSlug]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/team-group-link?${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ url: draft.trim() || null }),
      });
      const d = await res.json().catch(() => ({})) as { url?: string | null; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Saving failed');
      setUrl(d.url ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed');
    } finally {
      setSaving(false);
    }
  };

  if (url === undefined) return null;
  if (!url && !canEdit) return null;

  return (
    <Paper p="md" withBorder radius="md">
      <Stack gap="xs">
        <Text fw={700}>Team WhatsApp group</Text>
        {url && (
          <Button
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            leftSection={<IconBrandWhatsapp size={14} />}
            variant="light"
            color="green"
            radius="xl"
            w="fit-content"
          >
            Open group invite
          </Button>
        )}
        {canEdit && (
          <>
            <Text size="xs" c="dimmed">
              Only the team's coaches and managers and club editors can see this. Anyone in a WhatsApp group can see
              every member's phone number, so never post it publicly.
            </Text>
            <Group align="flex-end" wrap="wrap">
              <TextInput
                label="Group invite link"
                placeholder="https://chat.whatsapp.com/…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
                error={error}
              />
              <Button onClick={save} loading={saving} variant="default">Save</Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
