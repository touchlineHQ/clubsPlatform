import { useEffect, useState } from 'react';
import { useDisclosure } from '@mantine/hooks';
import {
  Stack, Tabs, Table, Badge, Button, Modal,
  Select, Textarea, Group, Alert, Text, Paper, Box,
} from '@mantine/core';
import { IconClock, IconCalendarEvent, IconRefresh } from '@tabler/icons-react';
import { PageHeader } from '../components/club/PageHeader';
import { clubDesign } from '../theme';

interface Pitch {
  id: string;
  name: string;
  formats: string[];
}

interface AdminRequest {
  id: string;
  userName: string;
  userEmail: string;
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
  createdAt: number;
}

interface ApproveForm {
  pitchId: string;
  timeStart: string;
  timeEnd: string;
  notes: string;
}

function getDurationByFormat(format: string): number {
  return format === "5v5" || format === "7v7" ? 1 : 2;
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const newH = (h + hours) % 24;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Props {
  clubFeedSlug?: string;
}

export function BookingAdminPage({ clubFeedSlug }: Props) {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<AdminRequest | null>(null);
  const [approveOpened, { open: openApprove, close: closeApprove }] = useDisclosure(false);
  const [declineOpened, { open: openDecline, close: closeDecline }] = useDisclosure(false);
  const [approveForm, setApproveForm] = useState<ApproveForm>({ pitchId: '', timeStart: '', timeEnd: '', notes: '' });
  const [declineReason, setDeclineReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchAll = async () => {
    try {
      const [reqRes, bkgRes, pitchRes] = await Promise.all([
        fetch('/api/booking-requests?status=pending'),
        fetch('/api/bookings'),
        fetch('/api/pitches'),
      ]);

      if (!reqRes.ok || !bkgRes.ok) {
        setError('Failed to load data');
        return;
      }

      if (reqRes.ok) {
        const data = await reqRes.json() as { requests: AdminRequest[] };
        setRequests(data.requests);
      }
      if (bkgRes.ok) {
        const data = await bkgRes.json() as { bookings: Booking[] };
        setBookings(data.bookings);
      }
      if (pitchRes.ok) {
        const data = await pitchRes.json() as { pitches: Pitch[] };
        setPitches(data.pitches);
      }
    } catch {
      setError('Failed to load data');
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleOpenApprove = (req: AdminRequest) => {
    const duration = getDurationByFormat(req.format);
    const newTimeEnd = addHours(req.timeStart, duration);
    setSelectedRequest(req);
    setApproveForm({ pitchId: '', timeStart: req.timeStart, timeEnd: newTimeEnd, notes: '' });
    setError('');
    openApprove();
  };

  const handleOpenDecline = (req: AdminRequest) => {
    setSelectedRequest(req);
    setDeclineReason('');
    setError('');
    openDecline();
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;
    if (!approveForm.pitchId) { setError('Please select a pitch'); return; }
    if (!approveForm.timeStart) { setError('Start time is required'); return; }
    if (!approveForm.timeEnd) { setError('End time is required'); return; }

    setProcessing(true);
    setError('');
    try {
      const res = await fetch(`/api/booking-requests?id=${selectedRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          pitchId: approveForm.pitchId,
          timeStart: approveForm.timeStart,
          timeEnd: approveForm.timeEnd,
          notes: approveForm.notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to approve request');
        return;
      }

      closeApprove();
      setSelectedRequest(null);
      setSuccessMsg('Booking approved successfully.');
      await fetchAll();
    } catch {
      setError('Failed to approve request. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!selectedRequest) return;

    setProcessing(true);
    setError('');
    try {
      const res = await fetch(`/api/booking-requests?id=${selectedRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason: declineReason || undefined }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to decline request');
        return;
      }

      closeDecline();
      setSelectedRequest(null);
      setSuccessMsg('Booking request declined.');
      await fetchAll();
    } catch {
      setError('Failed to decline request. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleImportFixtures = async () => {
    if (!clubFeedSlug) return;
    setImporting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/import-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubFeedSlug }),
      });
      const data = await res.json() as { ok?: boolean; created?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Import failed');
        return;
      }
      setSuccessMsg(`Import complete — ${data.created} created, ${data.skipped} skipped.`);
      await fetchAll();
    } catch {
      setError('Failed to import fixtures');
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteBooking = async (id: string) => {
    try {
      const res = await fetch(`/api/bookings?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to delete booking');
        return;
      }
      await fetchAll();
    } catch {
      setError('Failed to delete booking');
    }
  };

  const compatiblePitches = selectedRequest
    ? pitches.filter((p) => p.formats.includes(selectedRequest.format))
    : [];

  return (
    <Stack maw={1100} mx="auto" gap="lg">
      <PageHeader
        title="Booking Administration"
        subtitle={`${requests.length} pending request${requests.length === 1 ? '' : 's'} · ${bookings.length} confirmed booking${bookings.length === 1 ? '' : 's'}`}
        actions={clubFeedSlug ? (
          <Button
            size="sm"
            variant="light"
            radius="xl"
            loading={importing}
            onClick={handleImportFixtures}
            leftSection={<IconRefresh size={14} />}
          >
            Import Fixtures
          </Button>
        ) : null}
      />

      {successMsg && (
        <Alert color="green" variant="light" radius="md" onClose={() => setSuccessMsg('')} withCloseButton>
          {successMsg}
        </Alert>
      )}

      <Tabs defaultValue="pending">
        <Tabs.List>
          <Tabs.Tab value="pending" leftSection={<IconClock size={14} />}>
            Pending Requests {requests.length > 0 && `(${requests.length})`}
          </Tabs.Tab>
          <Tabs.Tab value="bookings" leftSection={<IconCalendarEvent size={14} />}>
            All Bookings
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="pending" pt="md">
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
              <Text c="dimmed">No pending requests.</Text>
            </Box>
          ) : (
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Manager</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Format</Table.Th>
                  <Table.Th>Notes</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {requests.map((req) => (
                  <Table.Tr key={req.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{req.userName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{req.userEmail}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{req.teamName}</Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{req.date}</Text></Table.Td>
                    <Table.Td><Text size="sm">{req.timeStart}–{req.timeEnd}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="light" radius="xl" size="sm">{req.format}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={1}>{req.notes ?? ''}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Button size="xs" color="green" radius="xl" onClick={() => handleOpenApprove(req)}>
                          Approve
                        </Button>
                        <Button size="xs" color="red" radius="xl" variant="light" onClick={() => handleOpenDecline(req)}>
                          Decline
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Paper>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="bookings" pt="md">
          {bookings.length === 0 ? (
            <Box
              p="xl"
              style={{
                background: clubDesign.color.n1,
                border: `1px dashed ${clubDesign.color.n3}`,
                borderRadius: clubDesign.radius.card,
                textAlign: 'center',
              }}
            >
              <Text c="dimmed">No bookings yet.</Text>
            </Box>
          ) : (
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Pitch</Table.Th>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Format</Table.Th>
                  <Table.Th>Notes</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {bookings.map((bkg) => (
                  <Table.Tr key={bkg.id}>
                    <Table.Td><Text size="sm">{bkg.date}</Text></Table.Td>
                    <Table.Td><Text size="sm">{bkg.timeStart}–{bkg.timeEnd}</Text></Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>{bkg.pitchName}</Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{bkg.teamName}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="light" radius="xl" size="sm">{bkg.format}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={1}>{bkg.notes ?? ''}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        radius="xl"
                        onClick={() => handleDeleteBooking(bkg.id)}
                      >
                        Delete
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Paper>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* Approve Modal */}
      <Modal
        opened={approveOpened}
        onClose={closeApprove}
        title="Approve Booking Request"
        size="md"
      >
        {selectedRequest && (
          <Stack>
            {error && <Alert color="red" variant="light">{error}</Alert>}

            <Paper p="md" withBorder radius="md" bg={clubDesign.color.n1}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs" style={{ letterSpacing: '0.05em' }}>
                Request Details
              </Text>
              <Stack gap={4}>
                <Text size="sm"><Text component="span" fw={600}>Manager:</Text> {selectedRequest.userName} ({selectedRequest.userEmail})</Text>
                <Text size="sm"><Text component="span" fw={600}>Team:</Text> {selectedRequest.teamName}</Text>
                <Text size="sm"><Text component="span" fw={600}>Date:</Text> {selectedRequest.date}</Text>
                <Text size="sm"><Text component="span" fw={600}>Requested time:</Text> {selectedRequest.timeStart}–{selectedRequest.timeEnd}</Text>
                <Text size="sm"><Text component="span" fw={600}>Format:</Text> {selectedRequest.format}</Text>
                {selectedRequest.notes && <Text size="sm"><Text component="span" fw={600}>Notes:</Text> {selectedRequest.notes}</Text>}
              </Stack>
            </Paper>

            <Select
              label="Pitch"
              placeholder="Select a pitch"
              value={approveForm.pitchId}
              onChange={(val) => setApproveForm((f) => ({ ...f, pitchId: val ?? '' }))}
              data={compatiblePitches.map((p) => ({ value: p.id, label: p.name }))}
              required
            />

            <Group grow>
              <Stack gap={4}>
                <Text size="sm" fw={500}>Start Time <span style={{ color: 'var(--mantine-color-red-6)' }}>*</span></Text>
                <input
                  type="time"
                  value={approveForm.timeStart}
                  onChange={(e) => {
                    const newStart = e.currentTarget.value;
                    const duration = selectedRequest ? getDurationByFormat(selectedRequest.format) : 2;
                    setApproveForm((f) => ({ ...f, timeStart: newStart, timeEnd: addHours(newStart, duration) }));
                  }}
                  style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${clubDesign.color.n3}`, fontSize: '14px', fontFamily: 'inherit' }}
                />
              </Stack>
              <Stack gap={4}>
                <Text size="sm" fw={500}>End Time <span style={{ color: 'var(--mantine-color-red-6)' }}>*</span></Text>
                <input
                  type="time"
                  value={approveForm.timeEnd}
                  onChange={(e) => setApproveForm((f) => ({ ...f, timeEnd: e.currentTarget?.value ?? f.timeEnd }))}
                  style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${clubDesign.color.n3}`, fontSize: '14px', fontFamily: 'inherit' }}
                />
              </Stack>
            </Group>

            <Textarea
              label="Notes (optional)"
              value={approveForm.notes}
              onChange={(e) => setApproveForm((f) => ({ ...f, notes: e.currentTarget.value }))}
              placeholder="Any notes for this booking..."
              rows={3}
            />

            <Group justify="flex-end">
              <Button variant="default" radius="xl" onClick={closeApprove} disabled={processing}>
                Cancel
              </Button>
              <Button color="green" radius="xl" onClick={handleApprove} loading={processing}>
                Confirm Approval
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Decline Modal */}
      <Modal
        opened={declineOpened}
        onClose={closeDecline}
        title="Decline Booking Request"
        size="sm"
      >
        {selectedRequest && (
          <Stack>
            {error && <Alert color="red" variant="light">{error}</Alert>}

            <Text size="sm">
              Declining request from <strong>{selectedRequest.userName}</strong> for{' '}
              <strong>{selectedRequest.teamName}</strong> on {selectedRequest.date}.
            </Text>

            <Textarea
              label="Reason (optional)"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.currentTarget.value)}
              placeholder="Reason for declining..."
              rows={3}
            />

            <Group justify="flex-end">
              <Button variant="default" radius="xl" onClick={closeDecline} disabled={processing}>
                Cancel
              </Button>
              <Button color="red" radius="xl" onClick={handleDecline} loading={processing}>
                Confirm Decline
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
