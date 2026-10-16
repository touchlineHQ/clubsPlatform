import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Paper, Radio, Select, Stack, Text, TextInput, Group } from '@mantine/core';
import { useClub } from '../../context/ClubContext';
import { captureError } from '../../lib/posthog';

interface AgeGroupOption { ageGroup: string; under16: boolean; teams: string[] }
interface FormConfig { ageGroups: AgeGroupOption[]; turnstileSiteKey: string | null; enabled: boolean }

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }): string;
      reset(id?: string): void;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load')));
    if (!existing) {
      script.src = TURNSTILE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Public "want to join?" enquiry (#73). Not a registration: it gives the club
 * secretary enough to start FA onboarding, then gets out of the way.
 *
 * Deliberately no free-text box — that is where unprompted medical details
 * end up. Under 16 the enquirer can only be a parent or guardian, so the
 * player's own email is never asked for.
 */
export function EnquiryForm() {
  const { clubSlug } = useClub();
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [ageGroup, setAgeGroup] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [enquirerType, setEnquirerType] = useState<'guardian' | 'player'>('guardian');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [playerFirstName, setPlayerFirstName] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/enquiries', { headers: { 'X-Club-Slug': clubSlug } })
      .then(async (res) => (res.ok ? (await res.json()) as FormConfig : null))
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => { if (!cancelled) setConfig(null); });
    return () => { cancelled = true; };
  }, [clubSlug]);

  // Without a site key there is no widget to render, so no form either (#73).
  const siteKey = config?.enabled && config.turnstileSiteKey?.trim() ? config.turnstileSiteKey.trim() : null;
  useEffect(() => {
    if (!siteKey || !widgetRef.current || widgetId.current) return;
    loadTurnstile()
      .then(() => {
        if (!widgetRef.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          callback: setToken,
          'expired-callback': () => setToken(''),
        });
      })
      .catch((e) => captureError(e, { source: 'enquiry turnstile' }));
  }, [siteKey]);

  if (!config || !siteKey || config.ageGroups.length === 0) return null;

  const group = config.ageGroups.find(g => g.ageGroup === ageGroup) ?? null;
  const under16 = group?.under16 ?? true;
  const asPlayer = !under16 && enquirerType === 'player';

  if (done) {
    return (
      <Paper p="xl" radius="md" withBorder>
        <Text fw={700}>Thanks — your enquiry has been sent.</Text>
        <Text size="sm" c="dimmed">The club secretary will be in touch. Check your inbox for a confirmation with the FA registration link.</Text>
      </Paper>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({
          ageGroup, team, enquirerType: asPlayer ? 'player' : 'guardian',
          contactName, contactEmail, contactPhone, playerFirstName,
          consent, website: honeypot, turnstileToken: token,
        }),
      });
      if (res.ok) { setDone(true); return; }
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? 'Something went wrong. Please try again.');
      window.turnstile?.reset(widgetId.current ?? undefined);
      setToken('');
    } catch (err) {
      captureError(err, { source: 'enquiry submit' });
      setError('Something went wrong. Please try again.');
      window.turnstile?.reset(widgetId.current ?? undefined);
      setToken('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper p="xl" radius="md" withBorder component="form" onSubmit={submit} aria-label="Player enquiry">
      <Stack gap="sm">
        <Text fw={800} fz="md">New to the club? Tell us you're interested</Text>
        <Text size="sm" c="dimmed">This is not FA registration. It lets our secretary get in touch and start it with you.</Text>
        <Select
          label="Age group" required data={config.ageGroups.map(g => g.ageGroup)} value={ageGroup}
          onChange={(v) => { setAgeGroup(v); setTeam(null); }}
        />
        {group && group.teams.length > 0 && (
          <Select label="Team (if you know it)" clearable data={group.teams} value={team} onChange={setTeam} />
        )}
        {group && !under16 && (
          <Radio.Group label="I am" value={enquirerType} onChange={(v) => setEnquirerType(v as 'guardian' | 'player')}>
            <Group mt={4}>
              <Radio value="guardian" label="A parent or guardian" />
              <Radio value="player" label="The player" />
            </Group>
          </Radio.Group>
        )}
        <TextInput label={asPlayer ? 'Your name' : 'Parent or guardian name'} required value={contactName} onChange={(e) => setContactName(e.currentTarget.value)} />
        <TextInput label={asPlayer ? 'Your email' : 'Parent or guardian email'} type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.currentTarget.value)} />
        <TextInput label="Phone (optional)" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.currentTarget.value)} />
        {!asPlayer && (
          <TextInput label="Player first name (optional)" value={playerFirstName} onChange={(e) => setPlayerFirstName(e.currentTarget.value)} />
        )}
        {/* Honeypot: hidden from people and screen readers, filled by bots. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Website<input name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.currentTarget.value)} /></label>
        </div>
        <Checkbox
          required checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)}
          label="I agree to the club holding these details to deal with this enquiry. They are deleted once it is closed, or after six months."
        />
        <div ref={widgetRef} />
        {error && <Alert color="red" variant="light">{error}</Alert>}
        <Button type="submit" radius="xl" loading={submitting} disabled={!ageGroup || !consent || !token}>
          Send enquiry
        </Button>
      </Stack>
    </Paper>
  );
}
