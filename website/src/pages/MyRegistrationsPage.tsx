import { useEffect, useState } from 'react';
import {
  Table, Stack, Alert, Loader, Center, Badge, Text, Paper, Box, Group, Button,
} from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useClub } from '../context/ClubContext';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
}

interface Response {
  registrations: RegistrationRow[];
  scope: 'admin' | 'user';
}

export function MyRegistrationsPage() {
  const { clubSlug } = useClub();
  const { isAdmin } = useAuth();
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [scope, setScope] = useState<'admin' | 'user'>('user');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/my-registrations', {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) throw new Error('Failed to load registrations');
        const data = await res.json() as Response;
        if (cancelled) return;
        setRegistrations(data.registrations);
        setScope(data.scope);
      } catch {
        if (!cancelled) setError('Failed to load registrations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubSlug]);

  const isAdminView = scope === 'admin' && isAdmin;

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <PageHeader
        title={isAdminView ? 'Club Registrations' : 'My Registrations'}
        subtitle={isAdminView
          ? 'All player registrations for this club.'
          : 'Player registrations linked to your account.'}
      />

      {error && <Alert color="red" variant="light">{error}</Alert>}

      {loading ? (
        <Center h={160}><Loader /></Center>
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
          <Stack align="center" gap="sm">
            <Text fw={700} ff={clubDesign.font.heading}>
              {isAdminView ? 'No registrations yet.' : 'No registrations linked to your account yet.'}
            </Text>
            {!isAdminView && (
              <>
                <Text size="sm" c="dimmed" maw={460}>
                  If you've registered with the club, our admins will link your account to your
                  player record. In the meantime, you can register or renew below.
                </Text>
                <Button
                  component={Link}
                  to="/register"
                  radius="xl"
                  rightSection={<IconArrowRight size={14} />}
                >
                  Register &amp; Pay
                </Button>
              </>
            )}
          </Stack>
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
                <Table.Th>{isAdminView ? 'Linked accounts' : 'Relationship'}</Table.Th>
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
                    {isAdminView ? (
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
                    ) : (
                      <Badge
                        size="sm"
                        variant="light"
                        color={r.relationship === 'self' ? 'blue' : 'grape'}
                        radius="xl"
                        tt="capitalize"
                      >
                        {r.relationship ?? '—'}
                      </Badge>
                    )}
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
