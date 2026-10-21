import { useEffect, useState } from 'react';
import {
  Alert, Button, CopyButton, Group, Paper, Select, Stack, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { IconCheck, IconCopy, IconSpeakerphone } from '@tabler/icons-react';
import type { NewsItem } from '../../types';
import { useClub } from '../../context/ClubContext';
import { useAuth } from '../../context/AuthContext';
import { captureEvent } from '../../lib/posthog';

interface Props {
  /** Called with the published item so the editor's copy of News keeps it. */
  onPublished: (item: NewsItem) => void;
}

type Result = {
  copyText: string;
  email: null | { sentCount: number; droppedCount: number; mailConfigured: boolean };
};

const NO_EMAIL = 'none';
const WHOLE_CLUB = 'club';

/**
 * Announcement composer (#74): written once, it is published as a news item,
 * optionally emailed to members with a valid basis, and turned into a block of
 * plain text for pasting into the club's WhatsApp Channel or a team group.
 */
export function AnnouncementForm({ onPublished }: Props) {
  const { clubSlug } = useClub();
  const { can } = useAuth();
  const canEmail = can('members');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<string>(NO_EMAIL);
  const [teams, setTeams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!canEmail) return;
    fetch('/api/admin/registration-facets', { headers: { 'X-Club-Slug': clubSlug } })
      .then(r => (r.ok ? r.json() : { teams: [] }))
      .then((d: { teams?: string[] }) => setTeams(d.teams ?? []))
      .catch(() => setTeams([]));
  }, [clubSlug, canEmail]);

  const audienceOptions = [
    { value: NO_EMAIL, label: 'Site only, no email' },
    ...(canEmail
      ? [
          { value: WHOLE_CLUB, label: 'Email the whole club' },
          ...teams.map(t => ({ value: `team:${t}`, label: `Email ${t}` })),
        ]
      : []),
  ];

  const publish = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    const email = audience === NO_EMAIL
      ? undefined
      : audience === WHOLE_CLUB
        ? { type: 'club' }
        : { type: 'team', teamName: audience.slice('team:'.length) };
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ title, text, body: body || undefined, email }),
      });
      const data = await res.json().catch(() => ({})) as Result & { item?: NewsItem; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error ?? `Publishing failed (${res.status})`);
      onPublished(data.item);
      setResult({ copyText: data.copyText, email: data.email });
      captureEvent('announcement published', { club_slug: clubSlug, emailed: !!data.email });
      setTitle('');
      setText('');
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <Stack gap="md">
      <Title order={4}>Announcement</Title>
      <Text size="sm" c="dimmed">
        Write it once. It goes on the club site as a news item, can be emailed to members, and gives you a
        block of text to paste into WhatsApp.
      </Text>
      <Paper p="sm" withBorder>
        <Stack gap="xs">
          <TextInput label="Title" value={title} onChange={e => setTitle(e.target.value)} required />
          <Textarea label="Message" value={text} onChange={e => setText(e.target.value)} minRows={3} required />
          <Textarea label="More detail" description="Optional" value={body} onChange={e => setBody(e.target.value)} minRows={3} />
          <Select
            label="Email"
            data={audienceOptions}
            value={audience}
            onChange={v => setAudience(v ?? NO_EMAIL)}
            allowDeselect={false}
            description="Only members who have activated their email and are currently registered receive it."
          />
          <Group>
            <Button
              leftSection={<IconSpeakerphone size={14} />}
              onClick={publish}
              loading={sending}
              disabled={!title.trim() || !text.trim()}
            >
              Publish
            </Button>
          </Group>
        </Stack>
      </Paper>

      {error && <Alert color="red">{error}</Alert>}

      {result && (
        <Paper p="sm" withBorder>
          <Stack gap="xs">
            <Text size="sm" fw={600}>Published to the club site.</Text>
            {result.email && (
              <Text size="sm">
                {result.email.mailConfigured
                  ? `Emailed ${result.email.sentCount} member${result.email.sentCount === 1 ? '' : 's'}`
                  : 'Email is not set up for this club yet, so nothing was sent'}
                {result.email.droppedCount > 0 ? `; ${result.email.droppedCount} skipped (not activated or not registered).` : '.'}
              </Text>
            )}
            <Textarea label="WhatsApp copy" value={result.copyText} readOnly rows={4} data-testid="whatsapp-copy" />
            <CopyButton value={result.copyText} timeout={2000}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  color={copied ? 'teal' : undefined}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  onClick={copy}
                  w="fit-content"
                >
                  {copied ? 'Copied' : 'Copy for WhatsApp'}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
