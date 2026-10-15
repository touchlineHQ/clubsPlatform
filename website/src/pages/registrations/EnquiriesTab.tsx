import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Center, Loader, NativeSelect, Table, Text, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { captureError } from '../../lib/posthog';

export interface Enquiry {
  id: string;
  ageGroup: string;
  team: string | null;
  enquirerType: 'guardian' | 'player';
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  playerFirstName: string | null;
  status: string;
  contactPurgedAt: number | null;
  createdAt: number;
}

export const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'fa_sent', label: 'FA invite sent' },
  { value: 'registered', label: 'Registered' },
  { value: 'declined', label: 'Declined' },
];

/**
 * Secretary triage of public player enquiries (#73). Moving one to
 * Registered or Declined deletes its contact details on the server.
 */
export function EnquiriesTab({ clubSlug }: { clubSlug: string }) {
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/enquiries', { headers: { 'X-Club-Slug': clubSlug } });
      if (!res.ok) throw new Error(`Failed to load enquiries (${res.status})`);
      setItems(((await res.json()) as { items: Enquiry[] }).items);
    } catch (e) {
      captureError(e, { source: 'enquiries load' });
      setError('Could not load enquiries.');
      setItems([]);
    }
  }, [clubSlug]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (init: RequestInit, url = '/api/admin/enquiries') => {
    setError(null);
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug } });
    if (!res.ok) setError('That change did not save.');
    await load();
  };

  if (items === null) return <Center h={120}><Loader /></Center>;

  return (
    <>
      {error && <Alert color="red" variant="light" mb="sm">{error}</Alert>}
      {items.length === 0 ? (
        <Text c="dimmed" size="sm">No enquiries yet. They arrive from the form on your Registration page.</Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Received</Table.Th><Table.Th>Age group</Table.Th><Table.Th>Contact</Table.Th>
                <Table.Th>Player</Table.Th><Table.Th>Status</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{new Date(e.createdAt).toLocaleDateString()}</Table.Td>
                  <Table.Td>{e.ageGroup}{e.team ? ` · ${e.team}` : ''}</Table.Td>
                  <Table.Td>
                    {e.contactEmail ? (
                      <>
                        <Text size="sm">{e.contactName} ({e.enquirerType === 'guardian' ? 'parent/guardian' : 'player'})</Text>
                        <Text size="xs" c="dimmed">{e.contactEmail}{e.contactPhone ? ` · ${e.contactPhone}` : ''}</Text>
                      </>
                    ) : <Text size="xs" c="dimmed">Contact details deleted</Text>}
                  </Table.Td>
                  <Table.Td>{e.playerFirstName ?? '—'}</Table.Td>
                  <Table.Td>
                    <NativeSelect
                      aria-label={`Status for enquiry ${e.id}`} size="xs" data={STATUS_OPTIONS} value={e.status}
                      onChange={(ev) => void mutate({ method: 'PATCH', body: JSON.stringify({ id: e.id, status: ev.currentTarget.value }) })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Delete enquiry">
                      <ActionIcon variant="subtle" color="red" aria-label="Delete enquiry"
                        onClick={() => void mutate({ method: 'DELETE' }, `/api/admin/enquiries?id=${encodeURIComponent(e.id)}`)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </>
  );
}
