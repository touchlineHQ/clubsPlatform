import { useEffect, useState } from 'react';
import {
  Table, Select, Stack, Alert, Loader, Center, Badge, Text,
  Tabs, Paper, Group, Button, Box,
} from '@mantine/core';
import { IconUsers, IconUserCog, IconShirt } from '@tabler/icons-react';
import type { LiveTeam, TeamRoleAssignment } from '../types';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string;
  registrationExpiry: string;
  registrationStatus: string;
  linkedAccounts: string | null;
}

interface DefinedTeam {
  id: string;
  sectionId: string;
  name: string;
}

interface DefinedSection {
  id: string;
  name: string;
}

interface Props {
  liveTeams: LiveTeam[];
}

export function AdminUsersPage({ liveTeams }: Props) {
  const { clubSlug } = useClub();
  const clubHeaders = { 'X-Club-Slug': clubSlug };

  // Users tab state
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  // Players tab state
  const [registrations, setRegistrations] = useState<PlayerRegistrationRow[]>([]);
  const [regsLoading, setRegsLoading] = useState(true);
  const [regsError, setRegsError] = useState('');

  // Team assignments tab state
  const [assignments, setAssignments] = useState<TeamRoleAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignError, setAssignError] = useState('');
  const [newUserId, setNewUserId] = useState<string | null>(null);
  const [newTeamSlug, setNewTeamSlug] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [definedSections, setDefinedSections] = useState<DefinedSection[]>([]);
  const [definedTeams, setDefinedTeams] = useState<DefinedTeam[]>([]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { headers: clubHeaders });
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json() as { users: UserRow[] };
      setUsers(data.users);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignments = async () => {
    try {
      const res = await fetch('/api/admin/user-team-roles', { headers: clubHeaders });
      if (!res.ok) throw new Error('Failed to load assignments');
      const data = await res.json() as { assignments: TeamRoleAssignment[] };
      setAssignments(data.assignments);
    } catch {
      setAssignError('Failed to load team assignments');
    } finally {
      setAssignmentsLoading(false);
    }
  };

  const fetchRegistrations = async () => {
    try {
      const res = await fetch('/api/admin/player-registrations', { headers: clubHeaders });
      if (!res.ok) throw new Error('Failed to load registrations');
      const data = await res.json() as { registrations: PlayerRegistrationRow[] };
      setRegistrations(data.registrations);
    } catch {
      setRegsError('Failed to load player registrations');
    } finally {
      setRegsLoading(false);
    }
  };

  const fetchDefinedTeams = async () => {
    try {
      const res = await fetch('/api/teams', { headers: clubHeaders });
      if (!res.ok) return;
      const data = await res.json() as {
        sections: DefinedSection[];
        teams: DefinedTeam[];
      };
      setDefinedSections(data.sections);
      setDefinedTeams(data.teams);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAssignments();
    fetchDefinedTeams();
    fetchRegistrations();
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdating(userId);
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) throw new Error('Failed to update role');
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch {
      setError('Failed to update role');
    } finally {
      setUpdating(null);
    }
  };

  const handleAddAssignment = async () => {
    if (!newUserId || !newTeamSlug || !newRole) {
      setAssignError('Please select a user, team, and role');
      return;
    }

    let teamSlug: string;
    let teamLeague: string;
    let teamName: string;

    if (newTeamSlug.startsWith('defined:')) {
      const [, rest] = newTeamSlug.split('defined:');
      const [teamId, name] = rest.split('|');
      teamSlug = `defined:${teamId}`;
      teamLeague = '';
      teamName = name;
    } else if (newTeamSlug.startsWith('dynamic:')) {
      const [, rest] = newTeamSlug.split('dynamic:');
      const [slug, league] = rest.split('|');
      const team = liveTeams.find(t => t.slug === slug && t.league === league);
      if (!team) {
        setAssignError('Dynamic team not found');
        return;
      }
      teamSlug = team.slug;
      teamLeague = team.league;
      teamName = team.name;
    } else {
      setAssignError('Invalid team selection format');
      return;
    }

    setAdding(true);
    setAssignError('');
    try {
      const res = await fetch('/api/admin/user-team-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clubHeaders },
        body: JSON.stringify({
          userId: newUserId,
          teamSlug,
          teamLeague,
          teamName,
          role: newRole,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setAssignError(data.error ?? 'Failed to add assignment');
        return;
      }
      setNewUserId(null);
      setNewTeamSlug(null);
      setNewRole(null);
      // Refresh both assignments and users (role may have been auto-upgraded)
      await Promise.all([fetchAssignments(), fetchUsers()]);
    } catch {
      setAssignError('Failed to add assignment');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveAssignment = async (id: string) => {
    setRemoving(id);
    setAssignError('');
    try {
      const res = await fetch(`/api/admin/user-team-roles?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: clubHeaders,
      });
      if (!res.ok) throw new Error('Failed to remove');
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch {
      setAssignError('Failed to remove assignment');
    } finally {
      setRemoving(null);
    }
  };

  const userOptions = users.map(u => ({
    value: u.id,
    label: `${u.name} (${u.email})`,
  }));

  const definedTeamOptions: { group: string; items: { value: string; label: string }[] }[] = definedSections
    .map(s => ({
      group: s.name,
      items: definedTeams
        .filter(t => t.sectionId === s.id)
        .map(t => ({ value: `defined:${t.id}|${t.name}`, label: t.name })),
    }))
    .filter(g => g.items.length > 0);

  const dynamicTeamOptions = liveTeams.map(t => ({
    value: `dynamic:${t.slug}|${t.league}`,
    label: `${t.name} (${t.league})`,
  }));

  const teamOptions = [
    ...definedTeamOptions,
    { group: 'Dynamic Teams', items: dynamicTeamOptions },
  ];

  const roleOptions = [
    { value: 'coach', label: 'Coach' },
    { value: 'manager', label: 'Manager' },
  ];

  const roleColor = (role: string) => {
    if (role === 'manager') return 'blue';
    if (role === 'coach') return 'teal';
    return 'gray';
  };

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <PageHeader
        title="Manage Users"
        subtitle={`${users.length} registered user${users.length !== 1 ? 's' : ''} · ${assignments.length} team assignment${assignments.length !== 1 ? 's' : ''}`}
      />

      <Tabs defaultValue="users">
        <Tabs.List>
          <Tabs.Tab value="users" leftSection={<IconUsers size={14} />}>Users</Tabs.Tab>
          <Tabs.Tab value="team-roles" leftSection={<IconUserCog size={14} />}>Team Assignments</Tabs.Tab>
          <Tabs.Tab value="players" leftSection={<IconShirt size={14} />}>
            Players
            {registrations.length > 0 && (
              <Badge size="xs" ml={6} variant="light" color="blue" radius="xl">{registrations.length}</Badge>
            )}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <Stack>
            {error && <Alert color="red" variant="light">{error}</Alert>}
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Role</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.map(user => (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Text fw={600} ff={clubDesign.font.heading} fz="sm">{user.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{user.email}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          value={user.role}
                          onChange={(val) => val && handleRoleChange(user.id, val)}
                          data={[
                            { value: 'admin', label: 'Admin' },
                            { value: 'manager', label: 'Manager' },
                            { value: 'member', label: 'Member' },
                          ]}
                          size="xs"
                          w={120}
                          radius="md"
                          disabled={updating === user.id}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="team-roles" pt="md">
          <Stack>
            {assignError && <Alert color="red" variant="light" onClose={() => setAssignError('')} withCloseButton>{assignError}</Alert>}

            <Paper p="lg" withBorder radius="md">
              <Text fw={800} ff={clubDesign.font.heading} fz="md" mb="sm">Add Assignment</Text>
              <Stack gap="sm">
                <Group align="flex-end" wrap="wrap" gap="sm">
                  <Select
                    label="User"
                    placeholder="Select user"
                    value={newUserId}
                    onChange={setNewUserId}
                    data={userOptions}
                    searchable
                    radius="md"
                    w={260}
                  />
                  <Select
                    label="Team"
                    placeholder="Select team"
                    value={newTeamSlug}
                    onChange={setNewTeamSlug}
                    data={teamOptions}
                    searchable
                    radius="md"
                    w={220}
                  />
                  <Select
                    label="Role"
                    placeholder="Select role"
                    value={newRole}
                    onChange={setNewRole}
                    data={roleOptions}
                    radius="md"
                    w={140}
                  />
                  <Button onClick={handleAddAssignment} loading={adding} radius="xl" mt={24}>
                    Add
                  </Button>
                </Group>
                <Text size="xs" c="dimmed">
                  Assigning Coach or Manager automatically upgrades the user's global role to Manager.
                </Text>
              </Stack>
            </Paper>

            {assignmentsLoading ? (
              <Center h={100}><Loader size="sm" /></Center>
            ) : assignments.length === 0 ? (
              <Box
                p="xl"
                style={{
                  background: clubDesign.color.n1,
                  border: `1px dashed ${clubDesign.color.n3}`,
                  borderRadius: clubDesign.radius.card,
                  textAlign: 'center',
                }}
              >
                <Text size="sm" c="dimmed">No team assignments yet.</Text>
              </Box>
            ) : (
              <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>User</Table.Th>
                      <Table.Th>Team</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {assignments.map(a => (
                      <Table.Tr key={a.id}>
                        <Table.Td>
                          <Text size="sm" fw={600}>{a.userName}</Text>
                          <Text size="xs" c="dimmed">{a.userEmail}</Text>
                        </Table.Td>
                        <Table.Td><Text size="sm">{a.teamName}</Text></Table.Td>
                        <Table.Td>
                          <Badge size="sm" color={roleColor(a.role)} variant="light" radius="xl" tt="capitalize">
                            {a.role}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            radius="xl"
                            loading={removing === a.id}
                            onClick={() => handleRemoveAssignment(a.id)}
                          >
                            Remove
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="players" pt="md">
          <Stack>
            {regsError && <Alert color="red" variant="light">{regsError}</Alert>}

            {regsLoading ? (
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
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
