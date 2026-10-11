import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert, Anchor, Button, Checkbox, Loader, Center, Paper, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useClub } from '../context/ClubContext';
import { clubDesign } from '../theme';

type Policy = {
  purpose: string;
  channel: string;
  policyVersion: string;
  wording: string;
  wordingHash: string;
};

type FormPayload = {
  club: { slug: string; name: string; privacyPath: string };
  contact: {
    id: string;
    email: string;
    state: string;
    relationship: string;
    operationalOptIn: boolean;
    marketingOptIn: boolean;
    fanId: string | null;
    teamName?: string | null;
  };
  operational: Policy;
  marketing: Policy;
};

/**
 * Club-scoped parent contact consent form (#149).
 *
 * No account / password. The activation token in the URL is the credential.
 * Names the club as controller; marketing stays off unless the parent ticks it.
 */
export function ParentConsentPage({ mode = 'activate' }: { mode?: 'activate' | 'decline' }) {
  const { token: rawToken } = useParams<{ token: string }>();
  const token = rawToken ?? '';
  const { clubSlug } = useClub();

  const [payload, setPayload] = useState<FormPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [operationalAgreed, setOperationalAgreed] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'confirmed' | 'withdrawn' | 'declined' | null>(null);
  const [resendNote, setResendNote] = useState('');
  const [submitError, setSubmitError] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('This consent link is missing its token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ token });
      if (mode === 'decline') query.set('mode', 'decline');
      const res = await fetch(`/api/consent/form?${query.toString()}`);
      const data = await res.json() as FormPayload & { error?: string };
      if (!res.ok) {
        setError(data.error || 'Could not load this consent form.');
        setPayload(null);
        return;
      }
      setPayload(data);
      setEmail(data.contact.email || '');
      setOperationalAgreed(false);
      setMarketingOptIn(false);
      if (data.contact.state === 'confirmed') {
        setDone('confirmed');
      } else if (data.contact.state === 'withdrawn') {
        setDone('withdrawn');
      } else {
        setDone(null);
      }
    } catch {
      setError('Could not load this consent form.');
    } finally {
      setLoading(false);
    }
  }, [mode, token]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!payload || !token) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/consent/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          token,
          email,
          operationalAgreed: true,
          operational: {
            policyVersion: payload.operational.policyVersion,
            wordingHash: payload.operational.wordingHash,
          },
          marketingOptIn,
          ...(marketingOptIn
            ? {
                marketing: {
                  policyVersion: payload.marketing.policyVersion,
                  wordingHash: payload.marketing.wordingHash,
                },
              }
            : {}),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setSubmitError(data.error || 'Could not save your choices.');
        return;
      }
      // The link is spent once activated, so show the outcome locally instead
      // of reloading it.
      setPayload((p) => p && {
        ...p,
        contact: { ...p.contact, email, state: 'confirmed', marketingOptIn },
      });
      setDone('confirmed');
    } catch {
      setSubmitError('Could not save your choices.');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/consent/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', token }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setSubmitError(data.error || 'Could not withdraw.');
        return;
      }
      setDone('withdrawn');
    } catch {
      setSubmitError('Could not withdraw.');
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/consent/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', token }),
      });
      if (!res.ok) {
        setSubmitError('This link is no longer valid.');
        return;
      }
      setDone('declined');
    } catch {
      setSubmitError('Could not record your choice.');
    } finally {
      setSubmitting(false);
    }
  };

  // The server answers the same for an unknown, expired or spent link, so the
  // offer of a fresh one is the same too.
  const requestFreshLink = async () => {
    setResendNote('');
    try {
      await fetch('/api/consent/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      // Same message either way.
    }
    setResendNote('If that link was valid, a new one is on its way to the same address.');
  };

  if (loading) {
    return <Center py="xl"><Loader /></Center>;
  }

  if (error || !payload) {
    return (
      <Stack maw={560} mx="auto" py="xl" px="md" gap="md">
        <Alert color="red" variant="light">{error || 'Consent form unavailable.'}</Alert>
        <Text size="sm">
          Links work once and expire. If yours has expired or was already used, we can send a fresh one
          to the address the club entered.
        </Text>
        <Button variant="light" radius="xl" onClick={() => void requestFreshLink()}>
          Send me a fresh link
        </Button>
        {resendNote && <Alert color="blue" variant="light">{resendNote}</Alert>}
      </Stack>
    );
  }

  const clubName = payload.club.name;
  // Prefer the club from the token payload; fall back to path context.
  const privacyTo = payload.club.privacyPath || '/#/privacy';

  return (
    <Stack maw={560} mx="auto" py="xl" px="md" gap="lg">
      <div>
        <Title order={2} ff={clubDesign.font.heading}>Contact consent</Title>
        <Text size="sm" c="dimmed" mt={4}>
          For {clubName}
          {payload.contact.fanId ? ` · player FAN ${payload.contact.fanId}` : ''}
          {payload.contact.teamName ? ` · ${payload.contact.teamName}` : ''}
          {clubSlug && clubSlug !== payload.club.slug
            ? ` · opened under /${clubSlug}/`
            : ''}
        </Text>
      </div>

      <Paper p="lg" withBorder radius="md">
        <Text size="sm" lh={1.55}>
          <strong>{clubName}</strong> is the data controller for this address.
          {' '}
          <Anchor component={Link} to="/privacy" size="sm">
            Read the club privacy notice
          </Anchor>
          {' '}
          ({privacyTo.replace(/^\/#/, '')}).
          This form does not create a website login.
        </Text>
      </Paper>

      {done === 'confirmed' && (
        <Alert color="green" variant="light" title="Thank you">
          {clubName} may use {payload.contact.email} for operational club admin
          {payload.contact.marketingOptIn ? ', and you opted in to club marketing' : ''}.
          You can withdraw below if you change your mind.
        </Alert>
      )}

      {done === 'declined' && (
        <Alert color="orange" variant="light" title="Thanks for letting us know">
          You don't need to do anything else. This address will not be contacted, and the club can see that
          you declined.
        </Alert>
      )}

      {mode === 'decline' && done === null && payload.contact.state === 'pending' && (
        <Paper p="md" withBorder radius="md">
          <Text size="sm" lh={1.55} mb="sm">
            Confirm that you did not agree to {clubName} holding this email address. We will stop using
            it and the club will see that you declined. You don't need to contact anybody.
          </Text>
          <Button color="orange" radius="xl" loading={submitting} onClick={() => void decline()}>
            I did not agree to this
          </Button>
        </Paper>
      )}

      {done === 'withdrawn' && (
        <Alert color="orange" variant="light" title="Withdrawn">
          This address will not be used for club contact from this record.
          Ask the club secretary if you need a new invitation.
        </Alert>
      )}

      {submitError && <Alert color="red" variant="light">{submitError}</Alert>}

      {mode === 'activate' && done === null && payload.contact.state === 'pending' && (
        <Stack gap="md">
          <TextInput
            label="Email the club should use"
            description="Pre-filled if the secretary already entered one. You can correct it."
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            type="email"
            required
            autoComplete="email"
          />

          <Paper p="md" withBorder radius="md">
            <Text size="sm" lh={1.55} mb="sm">{payload.operational.wording}</Text>
            <Checkbox
              label="I agree — the club may use this address for operational admin"
              checked={operationalAgreed}
              onChange={(e) => setOperationalAgreed(e.currentTarget.checked)}
              required
            />
          </Paper>

          <Paper p="md" withBorder radius="md">
            <Text size="sm" c="dimmed" mb="xs">Optional — off by default</Text>
            <Text size="sm" lh={1.55} mb="sm">{payload.marketing.wording}</Text>
            <Checkbox
              label="Also allow club marketing emails"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.currentTarget.checked)}
            />
          </Paper>

          <Button
            radius="xl"
            disabled={!operationalAgreed || !email.trim()}
            loading={submitting}
            onClick={() => void submit()}
          >
            Activate &amp; accept
          </Button>
        </Stack>
      )}

      {(done === 'confirmed' || payload.contact.state === 'confirmed') && done !== 'withdrawn' && (
        <Button
          variant="light"
          color="orange"
          radius="xl"
          loading={submitting}
          onClick={() => void withdraw()}
        >
          Withdraw contact consent
        </Button>
      )}
    </Stack>
  );
}
