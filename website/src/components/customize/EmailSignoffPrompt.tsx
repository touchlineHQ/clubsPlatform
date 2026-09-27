import { useEffect, useState } from 'react';
import { Alert, Button, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useClub } from '../../context/ClubContext';
import { captureEvent } from '../../lib/posthog';
import {
  EmailSignoffCheckboxes,
  allSignoffTicksSet,
  type EmailSignoffLiability,
  type EmailSignoffTicks,
} from '../EmailSignoffCheckboxes';

type SignoffStatus = {
  policyVersion: string;
  liabilities: EmailSignoffLiability[];
  current: boolean;
  acceptedLiabilities: string[];
};

/**
 * Blocking prompt on Customise for clubs that have not accepted the current
 * contact-email sign-off. New collection is gated server-side; this is the
 * place an existing club is asked to catch up before their next import (#130).
 */
export function EmailSignoffPrompt() {
  const { clubSlug } = useClub();
  const headers = { 'X-Club-Slug': clubSlug, 'Content-Type': 'application/json' };

  const [status, setStatus] = useState<SignoffStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ticks, setTicks] = useState<EmailSignoffTicks>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin/email-signoff', { headers: { 'X-Club-Slug': clubSlug } });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as SignoffStatus;
        if (cancelled) return;
        setStatus(data);
        const initial: EmailSignoffTicks = {};
        for (const l of data.liabilities) {
          initial[l.id] = data.acceptedLiabilities.includes(l.id);
        }
        setTicks(initial);
        if (!data.current) {
          captureEvent('club email signoff prompted', {
            club_slug: clubSlug,
            policy_version: data.policyVersion,
          });
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubSlug]);

  if (loading) {
    return (
      <Paper p="md" radius="md" withBorder>
        <Loader size="sm" />
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Could not load email sign-off status">
        <Text size="sm">{error}</Text>
      </Alert>
    );
  }

  if (!status || status.current || saved) {
    return null;
  }

  const canSubmit = allSignoffTicksSet(status.liabilities, ticks);

  async function handleAccept() {
    if (!status || !canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const liabilities: Record<string, boolean> = {};
      const wordingHashes: Record<string, string> = {};
      for (const l of status.liabilities) {
        liabilities[l.id] = true;
        wordingHashes[l.id] = l.wordingHash;
      }
      const res = await fetch('/api/admin/email-signoff', {
        method: 'POST',
        headers,
        body: JSON.stringify({ liabilities, policyVersion: status.policyVersion, wordingHashes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Alert
      icon={<IconAlertTriangle size={16} />}
      color="orange"
      radius="md"
      title="Contact-email sign-off required"
    >
      <Stack gap="md">
        <Text size="sm">
          Before the club can collect contact emails on an FA import, an admin must
          independently accept each liability below. Addresses imported without this
          sign-off are dropped server-side; registration data still imports.
        </Text>
        <Title order={5}>Sign off for policy version {status.policyVersion}</Title>
        <EmailSignoffCheckboxes
          liabilities={status.liabilities}
          ticks={ticks}
          onChange={setTicks}
          lockedIds={status.acceptedLiabilities}
          disabled={saving}
        />
        {error && <Text size="sm" c="red">{error}</Text>}
        <Button
          radius="xl"
          leftSection={saving ? undefined : <IconCheck size={14} />}
          loading={saving}
          disabled={!canSubmit || saving}
          onClick={() => void handleAccept()}
        >
          Accept and enable contact-email collection
        </Button>
      </Stack>
    </Alert>
  );
}
