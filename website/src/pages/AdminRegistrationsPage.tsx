import { useEffect, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text,
  Paper, Group, Button, Box, Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconFileUpload, IconShirt } from '@tabler/icons-react';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';
import { ImportPlayersPanel } from './admin-users/ImportPlayersPanel';

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string;
  registrationExpiry: string;
  registrationStatus: string;
  linkedAccounts: string | null;
}

export function AdminRegistrationsPage() {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug };

  const [registrations, setRegistrations] = useState<PlayerRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);

  const fetchRegistrations = async () => {
    try {
      const res = await fetch('/api/admin/player-registrations', { headers: clubHeaders });
      if (!res.ok) throw new Error('Failed to load registrations');
      const data = await res.json() as { registrations: PlayerRegistrationRow[] };
      setRegistrations(data.registrations);
    } catch {
      setError('Failed to load player registrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRegistrations();
  }, []);

  const handleImported = () => {
    closeImport();
    setLoading(true);
    fetchRegistrations();
  };

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <Group justify="space-between" align="flex-end">
        <PageHeader
          title="Registrations"
          subtitle={`${registrations.length} player registration${registrations.length !== 1 ? 's' : ''}`}
        />
        <Button
          leftSection={<IconFileUpload size={16} />}
          onClick={openImport}
          radius="xl"
          variant="light"
        >
          Import Players
        </Button>
      </Group>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      {loading ? (
        <Center h={100}><Loader size="sm" /></Center>
      ) : registrations.length === 0 ? (
        <Box
          p="xl"
          style={{
            background: clubDesign.color.n1,
            border: `1px dashed ${clubDesign.color.n3}`,
            borderRadius: clubDesign.radius.card,
            textAlign: 'center',
          }}
        >
          <Text size="sm" c="dimmed">No player registrations yet. Use Import Players to get started.</Text>
        </Box>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <Table striped highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>FAN ID</Table.Th>
                <Table.Th>Team</Table.Th>
                <Table.Th>Age</Table.Th>
                <Table.Th>Expiry</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Linked accounts</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {registrations.map(r => (
                <Table.Tr key={r.registrationId}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{r.fanId}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{r.teamName}</Text></Table.Td>
                  <Table.Td><Text size="sm">{r.ageGroup || '—'}</Text></Table.Td>
                  <Table.Td><Text size="sm">{r.registrationExpiry || '—'}</Text></Table.Td>
                  <Table.Td>
                    {r.registrationStatus ? (
                      <Badge
                        size="sm"
                        variant="light"
                        color={r.registrationStatus.toLowerCase().includes('registered') ? 'green' : 'orange'}
                        radius="xl"
                      >
                        {r.registrationStatus}
                      </Badge>
                    ) : '—'}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="wrap">
                      {r.linkedAccounts
                        ? r.linkedAccounts.split(',').map((pair, i) => {
                            const [email, rel] = pair.split('|');
                            return (
                              <Badge
                                key={i}
                                size="xs"
                                variant="light"
                                color={rel === 'self' ? 'blue' : 'grape'}
                                radius="xl"
                                title={rel}
                              >
                                {email}
                              </Badge>
                            );
                          })
                        : <Text size="xs" c="dimmed">—</Text>
                      }
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal
        opened={importOpened}
        onClose={closeImport}
        title="Import Players"
        size="xl"
        radius="md"
      >
        <ImportPlayersPanel onImported={handleImported} />
      </Modal>
    </Stack>
  );
}
