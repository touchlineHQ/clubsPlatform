import { useEffect, useState } from 'react';
import { Stack, Text, Table, Badge, Divider, Group, Loader, Center, Alert, Tabs, Box, Paper } from '@mantine/core';
import { IconCalendarMonth, IconList } from '@tabler/icons-react';
import { DatePicker } from '@mantine/dates';
import { useAuth } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

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

interface Booking {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  teamName: string;
  teamSlug?: string;
  teamLeague?: string;
  format: string;
  notes?: string;
  pitchName: string;
  pitchId: string;
}

interface Pitch {
  id: string;
  name: string;
  formats: string[];
}

function statusColor(status: string) {
  if (status === 'approved') return 'green';
  if (status === 'declined') return 'red';
  return 'yellow';
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const DAY_START = 7;
const DAY_END = 22;
const TOTAL_HOURS = DAY_END - DAY_START;
const HOUR_LABELS = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => DAY_START + i);

function timeToFraction(time: string) {
  const [h, m] = time.split(':').map(Number);
  return Math.max(0, Math.min(1, (h + m / 60 - DAY_START) / TOTAL_HOURS));
}

export function PitchSchedulePage() {
  const { isManager, isAdmin, isPlatformAdmin, user } = useAuth();
  const { isMultiClub, clubSlug } = useClub();
  const belongsToClub = !isMultiClub || isPlatformAdmin || user?.clubSlug === clubSlug;
  const canManage = (isManager || isAdmin) && belongsToClub;
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [dayBookings, setDayBookings] = useState<Booking[]>([]);
  const [dayPitches, setDayPitches] = useState<Pitch[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  useEffect(() => {
    const fetches: Promise<void>[] = [
      fetch('/api/bookings')
        .then(r => r.ok ? r.json() as Promise<{ bookings: Booking[] }> : Promise.reject())
        .then(d => setBookings(d.bookings))
        .catch(() => setError('Failed to load bookings')),
    ];

    if (canManage) {
      fetches.push(
        fetch('/api/booking-requests')
          .then(r => r.ok ? r.json() as Promise<{ requests: BookingRequest[] }> : Promise.reject())
          .then(d => setRequests([...d.requests].sort((a, b) => b.createdAt - a.createdAt)))
          .catch(() => {})
      );
    }

    Promise.all(fetches).finally(() => setLoading(false));
  }, [canManage]);

  useEffect(() => {
    fetch('/api/pitches')
      .then(r => r.ok ? r.json() as Promise<{ pitches: Pitch[] }> : Promise.reject())
      .then(d => setDayPitches(d.pitches))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setDayLoading(true);
    fetch(`/api/bookings?date=${selectedDate}`)
      .then(r => r.ok ? r.json() as Promise<{ bookings: Booking[] }> : Promise.reject())
      .then(d => setDayBookings(d.bookings))
      .catch(() => setDayBookings([]))
      .finally(() => setDayLoading(false));
  }, [selectedDate]);

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  const upcoming = bookings.filter(b => b.date >= today);
  const past = bookings.filter(b => b.date < today);
  const bookedDates = new Set(bookings.map(b => b.date));

  return (
    <Stack maw={1100} mx="auto" gap="lg">
      <PageHeader
        title="Pitch Schedule"
        subtitle={`${upcoming.length} upcoming · ${past.length} past · all confirmed bookings`}
      />

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}

      <Tabs defaultValue="calendar">
        <Tabs.List>
          <Tabs.Tab value="calendar" leftSection={<IconCalendarMonth size={14} />}>Calendar</Tabs.Tab>
          <Tabs.Tab value="list" leftSection={<IconList size={14} />}>List</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="calendar" pt="md">
          <Paper p="lg" withBorder radius="md">
          <Group align="flex-start" gap="xl" wrap="wrap">
            <DatePicker
              value={selectedDate}
              onChange={setSelectedDate}
              getDayProps={(date) => bookedDates.has(date)
                ? { style: { fontWeight: 700, textDecoration: 'underline dotted' } }
                : {}
              }
            />

            <Stack flex={1} style={{ minWidth: 300 }}>
              {selectedDate && (
                <Text size="sm" fw={500}>{formatDate(selectedDate)}</Text>
              )}

              {dayLoading ? (
                <Center h={80}><Loader size="sm" /></Center>
              ) : (
                <Box style={{ overflowX: 'auto' }}>
                  <Box style={{ minWidth: 420 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', marginBottom: 4 }}>
                      <div />
                      <div style={{ position: 'relative', height: 20 }}>
                        {HOUR_LABELS.map(h => (
                          <span
                            key={h}
                            style={{
                              position: 'absolute',
                              left: `${((h - DAY_START) / TOTAL_HOURS) * 100}%`,
                              fontSize: 10,
                              color: '#868e96',
                              transform: 'translateX(-50%)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {`${h}:00`}
                          </span>
                        ))}
                      </div>
                    </div>

                    {dayPitches.map((pitch, idx) => {
                      const pitchBookings = dayBookings.filter(b => b.pitchId === pitch.id);
                      return (
                        <div
                          key={pitch.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '110px 1fr',
                            borderTop: idx === 0 ? '1px solid #dee2e6' : undefined,
                            borderBottom: '1px solid #dee2e6',
                          }}
                        >
                          <div style={{ padding: '8px 8px 8px 0', display: 'flex', alignItems: 'center' }}>
                            <Text size="xs" fw={600} lineClamp={2}>{pitch.name}</Text>
                          </div>
                          <div
                            style={{
                              position: 'relative',
                              height: 44,
                              background: idx % 2 === 0 ? '#f8f9fa' : '#fff',
                              borderLeft: '1px solid #dee2e6',
                            }}
                          >
                            {HOUR_LABELS.slice(1, -1).map(h => (
                              <div
                                key={h}
                                style={{
                                  position: 'absolute',
                                  left: `${((h - DAY_START) / TOTAL_HOURS) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  width: 1,
                                  background: '#e9ecef',
                                }}
                              />
                            ))}
                            {pitchBookings.map(bkg => {
                              const left = timeToFraction(bkg.timeStart) * 100;
                              const right = timeToFraction(bkg.timeEnd) * 100;
                              const width = right - left;
                              return (
                                <div
                                  key={bkg.id}
                                  title={`${bkg.teamName} · ${bkg.timeStart}–${bkg.timeEnd} · ${bkg.format}`}
                                  style={{
                                    position: 'absolute',
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    top: 5,
                                    bottom: 5,
                                    background: 'var(--mantine-primary-color-filled)',
                                    borderRadius: 4,
                                    overflow: 'hidden',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 5px',
                                    cursor: 'default',
                                  }}
                                >
                                  <Text size="xs" c="white" truncate fw={500}>
                                    {bkg.teamName}
                                  </Text>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {dayPitches.length === 0 && (
                      <Text size="sm" c="dimmed">No pitch data available.</Text>
                    )}

                    {dayPitches.length > 0 && dayBookings.length === 0 && (
                      <Text size="sm" c="dimmed" mt="sm">No bookings on this date.</Text>
                    )}
                  </Box>
                </Box>
              )}
            </Stack>
          </Group>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="list" pt="md">
          <Stack>
            {canManage && (
              <>
                <Divider label="Your Requests" labelPosition="left" />
                {requests.length === 0 ? (
                  <Text size="sm" c="dimmed">You have no booking requests.</Text>
                ) : (
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
                      {requests.map(req => (
                        <Table.Tr key={req.id}>
                          <Table.Td>{formatDate(req.date)}</Table.Td>
                          <Table.Td>{req.timeStart}–{req.timeEnd}</Table.Td>
                          <Table.Td>{req.teamName}</Table.Td>
                          <Table.Td>{req.format}</Table.Td>
                          <Table.Td>
                            <Badge color={statusColor(req.status)} variant="light" size="sm">
                              {req.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c={req.status === 'declined' ? 'red' : undefined}>
                              {req.status === 'declined' && req.declineReason
                                ? req.declineReason
                                : req.notes ?? ''}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </>
            )}

            <Divider label="Upcoming Bookings" labelPosition="left" mt="sm" />
            {upcoming.length === 0 ? (
              <Text size="sm" c="dimmed">No upcoming bookings.</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Pitch</Table.Th>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Format</Table.Th>
                    <Table.Th>Notes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {upcoming.map(bkg => (
                    <Table.Tr key={bkg.id}>
                      <Table.Td>{formatDate(bkg.date)}</Table.Td>
                      <Table.Td>{bkg.timeStart}–{bkg.timeEnd}</Table.Td>
                      <Table.Td><Text fw={500} size="sm">{bkg.pitchName}</Text></Table.Td>
                      <Table.Td>{bkg.teamName}</Table.Td>
                      <Table.Td><Badge variant="light" size="sm">{bkg.format}</Badge></Table.Td>
                      <Table.Td><Text size="xs">{bkg.notes ?? ''}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            {past.length > 0 && (
              <>
                <Divider label="Past Bookings" labelPosition="left" mt="sm" />
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Time</Table.Th>
                      <Table.Th>Pitch</Table.Th>
                      <Table.Th>Team</Table.Th>
                      <Table.Th>Format</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...past].reverse().map(bkg => (
                      <Table.Tr key={bkg.id} style={{ opacity: 0.6 }}>
                        <Table.Td>{formatDate(bkg.date)}</Table.Td>
                        <Table.Td>{bkg.timeStart}–{bkg.timeEnd}</Table.Td>
                        <Table.Td>{bkg.pitchName}</Table.Td>
                        <Table.Td>{bkg.teamName}</Table.Td>
                        <Table.Td><Badge variant="outline" size="sm" color="gray">{bkg.format}</Badge></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}

            {bookings.length === 0 && (
              <Group justify="center" py="xl">
                <Text c="dimmed">No bookings have been confirmed yet.</Text>
              </Group>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
