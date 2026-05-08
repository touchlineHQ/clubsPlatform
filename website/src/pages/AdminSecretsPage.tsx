import { useEffect, useState } from 'react';
import {
  Stack, Alert, Loader, Center, Text, Paper, Group, Button,
  Table, Select, ActionIcon, Box, PasswordInput,
} from '@mantine/core';
import { IconAlertCircle, IconTrash, IconDeviceFloppy } from '@tabler/icons-react';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface SecretRow {
  id: string;
  key: string;
  updatedAt: number;
}

async function encryptForTransport(spkiBase64: string, plaintext: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(spkiBase64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'spki', keyBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, key,
    new TextEncoder().encode(plaintext),
  );
  return btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function AdminSecretsPage() {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug } as HeadersInit;

  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const ALLOWED_KEYS = ['GC_ACCESS_TOKEN'];

  const [newKey, setNewKey] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchSecrets = async () => {
    try {
      const res = await fetch('/api/admin/secrets', { headers: clubHeaders });
      if (!res.ok) throw new Error('Failed to load secrets');
      const data = await res.json() as { secrets: SecretRow[]; publicKey: string | null };
      setSecrets(data.secrets);
      setPublicKey(data.publicKey);
    } catch {
      setError('Failed to load secrets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSecrets(); }, []);

  const handleSave = async () => {
    setSaveError('');
    if (!newKey) { setSaveError('Please select a key'); return; }
    if (!newValue.trim()) { setSaveError('Value is required'); return; }
    const key = newKey;

    if (!publicKey) { setSaveError('Transport key not configured on server'); return; }

    setSaving(true);
    try {
      const encryptedValue = await encryptForTransport(publicKey, newValue);
      const res = await fetch('/api/admin/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({ key, encryptedValue }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setSaveError(data.error ?? 'Failed to save secret'); return; }
      setNewKey(null);
      setNewValue('');
      await fetchSecrets();
    } catch {
      setSaveError('Failed to save secret');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    setDeleting(key);
    try {
      const res = await fetch(`/api/admin/secrets?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: clubHeaders,
      });
      if (!res.ok) { setError('Failed to delete secret'); return; }
      setSecrets(prev => prev.filter(s => s.key !== key));
    } catch {
      setError('Failed to delete secret');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <Center h={200}><Loader /></Center>;

  return (
    <Stack maw={800} mx="auto" gap="lg">
      <PageHeader
        title="API Secrets"
        subtitle="Encrypted API keys and credentials for backend integrations"
      />

      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light" radius="md">
        Secret values are <strong>write-only</strong>. Once saved, the value cannot be retrieved
        from the dashboard — only overwritten or deleted. Values are encrypted at rest using
        AES-256-GCM and never sent to your browser.
      </Alert>

      {!publicKey && !loading && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light" radius="md">
          <strong>Transport key not configured.</strong> Set <code>SECRETS_TRANSPORT_PRIVATE_KEY</code>{' '}
          and <code>SECRETS_TRANSPORT_PUBLIC_KEY</code> on the server before saving secrets.
          See the README for generation instructions.
        </Alert>
      )}

      <Paper p="lg" withBorder radius="md">
        <Text fw={800} ff={clubDesign.font.heading} fz="md" mb="sm">Add or Update Secret</Text>
        <Stack gap="sm">
          <Group align="flex-end" wrap="wrap" gap="sm">
            <Select
              label="Key"
              placeholder="Select a key"
              value={newKey}
              onChange={setNewKey}
              data={ALLOWED_KEYS}
              radius="md"
              w={260}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
            <PasswordInput
              label="Value"
              placeholder="Paste secret value"
              value={newValue}
              onChange={e => setNewValue(e.currentTarget.value)}
              radius="md"
              w={280}
            />
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={handleSave}
              loading={saving}
              radius="xl"
              mt={24}
            >
              Save Secret
            </Button>
          </Group>
          {saveError && (
            <Alert color="red" variant="light" radius="md">{saveError}</Alert>
          )}
        </Stack>
      </Paper>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}

      {secrets.length === 0 ? (
        <Box
          p="xl"
          style={{
            background: clubDesign.color.n1,
            border: `1px dashed ${clubDesign.color.n3}`,
            borderRadius: clubDesign.radius.card,
            textAlign: 'center',
          }}
        >
          <Text size="sm" c="dimmed">No secrets configured yet.</Text>
        </Box>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Key</Table.Th>
                <Table.Th>Last updated</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {secrets.map(secret => (
                <Table.Tr key={secret.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={600}>{secret.key}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {new Date(secret.updatedAt).toLocaleString()}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" ff="monospace">••••••••</Text>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      radius="xl"
                      loading={deleting === secret.key}
                      onClick={() => handleDelete(secret.key)}
                      aria-label={`Delete ${secret.key}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
