import { useEffect, useState } from 'react';
import {
  Stack, Text, Tabs, Table, Badge, Button,
  Select, Textarea, Alert, Group, Paper, Box,
} from '@mantine/core';
import { IconCalendarPlus, IconListDetails } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import type { LiveTeam } from '../types';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Pitch {
  id: string;
  name: string;
  formats: string[];
}

interface TeamOption {
  group: string;
  items: { value: string; label: string }[];
}

interface Pitch {
  id: string;
  name: string;
  formats: string[];
}

interface TeamOption {
  group: string;
  items: { value: string; label: string }[];
}

interface BookingRequest {
  id: string;
  teamName: string;
  teamSlug?: string;
  teamLeague?: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  format: string;
  notes?: string;
  status: string;
  declineReason?: string;
  createdAt: number;
}

const FORMAT_OPTIONS = [
  { value: '11v11', label: '11v11' },
  { value: '9v9', label: '9v9' },
  { value: '7v7', label: '7v7' },
  { value: '5v5', label: '5v5' },
];

function statusColor(status: string) {
  if (status === 'approved') return 'green';
  if (status === 'declined') return 'red';
  return 'yellow';
}

interface Props {
  liveTeams: LiveTeam[];
}

export function PitchBookingPage({ liveTeams }: Props) {
  const { teamRoles } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [dynamicTeamOptions, setDynamicTeamOptions] = useState<{ value: string; label: string }[]>([]);
  const [allTeamOptions, setAllTeamOptions] = useState<TeamOption[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('request');

  // Form state
  const [selectedTeamValue, setSelectedTeamValue] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [teamSlug, setTeamSlug] = useState<string | null>(null);
  const [teamLeague, setTeamLeague] = useState<string | null>(null);
  const [isDynamicTeam, setIsDynamicTeam] = useState(false);
  const [date, setDate] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [format, setFormat] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchPitches = async () => {
    try {
      const res = await fetch('/api/pitches');
      if (res.ok) {
        const data = await res.json() as { pitches: Pitch[] };
        setPitches(data.pitches);
      }
    } catch {
      // ignore
    }
  };

  const fetchTeams = async () => {
    try {
      const res = await fetch('/api/teams');
      if (!res.ok) return;
      const data = await res.json() as {
        sections: { id: string; name: string }[];
        teams: { id: string; sectionId: string; name: string }[];
      };
      const grouped: TeamOption[] = data.sections.map(s => ({
        group: s.name,
        items: data.teams
          .filter(t => t.sectionId === s.id)
          .map(t => ({ value: `defined:${t.id}|${t.name}`, label: t.name })),
      })).filter(g => g.items.length > 0);
      setTeamOptions(grouped);

      // Set dynamic team options from liveTeams
      setDynamicTeamOptions(
        liveTeams
          .map(t => ({ value: `dynamic:${t.slug}|${t.league}|${t.name}`, label: `${t.name} (${t.league})` }))
          .sort((a, b) => a.label.localeCompare(b.label))
      );

      // Build combined team options with user's teams at the top
      const userTeamItems = teamRoles
        .filter(r => r.role === 'coach' || r.role === 'manager')
        .map(r => {
          // Check if this is a defined team
          const definedTeam = data.teams.find(t => t.name === r.teamName);
          if (definedTeam) {
            return { value: `defined:${definedTeam.id}|${r.teamName}`, label: `${r.teamName} (${r.role})` };
          }
          // Dynamic team
          return { value: `dynamic:${r.teamSlug}|${r.teamLeague}|${r.teamName}`, label: `${r.teamName} (${r.teamLeague}) - ${r.role}` };
        });

      const allTeamOptions: TeamOption[] = [];
      if (userTeamItems.length > 0) {
        allTeamOptions.push({ group: 'Your Teams', items: userTeamItems });
      }
      // Add defined teams
      allTeamOptions.push(...grouped);
      // Add dynamic teams
      if (dynamicTeamOptions.length > 0) {
        allTeamOptions.push({ group: 'Dynamic Teams', items: dynamicTeamOptions });
      }
      setAllTeamOptions(allTeamOptions);

      // Pre-fill team if user has exactly one coach/manager assignment
      if (userTeamItems.length === 1) {
        setSelectedTeamValue(userTeamItems[0].value);
        setTeamName(userTeamItems[0].label.split(' (')[0]);
        // Set slug/league for dynamic teams
        if (userTeamItems[0].value.startsWith('dynamic:')) {
          const parts = userTeamItems[0].value.split('|');
          setTeamSlug(parts[1]);
          setTeamLeague(parts[2]);
        }
      }
    } catch {
      // ignore
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/booking-requests');
      if (res.ok) {
        const data = await res.json() as { requests: BookingRequest[] };
        // Show newest first
        const sorted = [...data.requests].sort((a, b) => b.createdAt - a.createdAt);
        setRequests(sorted);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchPitches();
    fetchTeams();
    fetchRequests();
  }, [teamRoles]);

  const handleSubmit = async () => {
    setError('');
    setSuccess('');

    if (!teamName) { setError('Team name is required'); return; }
    if (!date) { setError('Date is required'); return; }
    if (!timeStart) { setError('Start time is required'); return; }
    if (!timeEnd) { setError('End time is required'); return; }
    if (!format) { setError('Format is required'); return; }
    if (timeEnd <= timeStart) { setError('End time must be after start time'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/booking-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName,
          teamSlug: isDynamicTeam ? teamSlug : null,
          teamLeague: isDynamicTeam ? teamLeague : null,
          date,
          timeStart,
          timeEnd,
          format,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to submit request');
        return;
      }

      setSuccess('Your booking request has been submitted and is pending approval.');
      setSelectedTeamValue(null);
      setTeamName(null);
      setTeamSlug(null);
      setTeamLeague(null);
      setIsDynamicTeam(false);
      setDate('');
      setTimeStart('');
      setTimeEnd('');
      setFormat(null);
      setNotes('');
      await fetchRequests();
      setActiveTab('my-requests');
    } catch {
      setError('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack maw={900} mx="auto" gap="lg">
      <PageHeader
        title="Pitch Bookings"
        subtitle="Request a pitch booking or view your existing requests."
      />

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="request" leftSection={<IconCalendarPlus size={14} />}>
            Request a Pitch
          </Tabs.Tab>
          <Tabs.Tab value="my-requests" leftSection={<IconListDetails size={14} />}>
            My Requests
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="request" pt="md">
          <Paper p="lg" withBorder radius="md">
            <Stack>
              {error && <Alert color="red" variant="light" onClose={() => setError('')} withCloseButton>{error}</Alert>}
              {success && <Alert color="green" variant="light" onClose={() => setSuccess('')} withCloseButton>{success}</Alert>}

              <Select
                label="Team"
                placeholder="Select your team"
                value={selectedTeamValue}
                onChange={(val) => {
                  setSelectedTeamValue(val);
                  if (!val) {
                    setTeamName(null);
                    setTeamSlug(null);
                    setTeamLeague(null);
                    setIsDynamicTeam(false);
                    return;
                  }
                  
                  if (val.startsWith('defined:')) {
                    const [, rest] = val.split('defined:');
                    const [teamId, name] = rest.split('|');
                    setTeamName(name);
                    setTeamSlug(null);
                    setTeamLeague(null);
                    setIsDynamicTeam(false);
                  } else if (val.startsWith('dynamic:')) {
                    const [, rest] = val.split('dynamic:');
                    const [slug, league, name] = rest.split('|');
                    setTeamSlug(slug);
                    setTeamLeague(league);
                    setTeamName(name);
                    setIsDynamicTeam(true);
                  }
                }}
                data={allTeamOptions}
                searchable
                required
              />

              <Stack gap={4}>
                <Text size="sm" fw={500}>Date <span style={{ color: 'var(--mantine-color-red-6)' }}>*</span></Text>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.currentTarget.value)}
                  style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${clubDesign.color.n3}`, fontSize: '14px', fontFamily: 'inherit' }}
                />
              </Stack>

              <Group grow>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>Start Time <span style={{ color: 'var(--mantine-color-red-6)' }}>*</span></Text>
                  <input
                    type="time"
                    value={timeStart}
                    onChange={(e) => setTimeStart(e.currentTarget.value)}
                    style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${clubDesign.color.n3}`, fontSize: '14px', fontFamily: 'inherit' }}
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>End Time <span style={{ color: 'var(--mantine-color-red-6)' }}>*</span></Text>
                  <input
                    type="time"
                    value={timeEnd}
                    onChange={(e) => setTimeEnd(e.currentTarget.value)}
                    style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${clubDesign.color.n3}`, fontSize: '14px', fontFamily: 'inherit' }}
                  />
                </Stack>
              </Group>

              <Select
                label="Format"
                placeholder="Select format"
                value={format}
                onChange={setFormat}
                data={FORMAT_OPTIONS}
                required
              />

              <Text size="xs" c="dimmed">
                Available pitches: {pitches.length > 0 ? pitches.map(p => `${p.name} (${p.formats.join(', ')})`).join(' · ') : 'Loading...'}
              </Text>

              <Textarea
                label="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
                placeholder="Any additional information..."
                rows={3}
              />

              <Button onClick={handleSubmit} loading={submitting} radius="xl" size="md">
                Submit Request
              </Button>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="my-requests" pt="md">
          {requests.length === 0 ? (
            <Box
              p="xl"
              style={{
                background: clubDesign.color.n1,
                border: `1px dashed ${clubDesign.color.n3}`,
                borderRadius: clubDesign.radius.card,
                textAlign: 'center',
              }}
            >
              <Text c="dimmed">You have no booking requests yet.</Text>
            </Box>
          ) : (
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Format</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Notes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {requests.map((req) => (
                  <Table.Tr key={req.id}>
                    <Table.Td><Text size="sm">{req.date}</Text></Table.Td>
                    <Table.Td><Text size="sm">{req.timeStart}–{req.timeEnd}</Text></Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{req.teamName}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="light" radius="xl" size="sm">{req.format}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(req.status)} variant="light" radius="xl" size="sm" tt="capitalize">
                        {req.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {req.status === 'declined' && req.declineReason
                        ? <Text size="xs" c="red">{req.declineReason}</Text>
                        : req.notes
                          ? <Text size="xs" c="dimmed" lineClamp={2}>{req.notes}</Text>
                          : null}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Paper>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
