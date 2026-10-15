import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Center, Loader, NativeSelect, Table, Text, Tooltip } from '@mantine/core';
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

/** Statuses that close an enquiry; the server deletes its contact details. */
const TERMINAL_STATUSES = ['registered', 'declined'];

async function fetchPage(clubSlug: string, offset: number) {
  const res = await fetch(`/api/admin/enquiries?offset=${offset}`, { headers: { 'X-Club-Slug': clubSlug } });
  if (!res.ok) throw new Error(`Failed to load enquiries (${res.status})`);
  return (await res.json()) as { items: Enquiry[]; hasMore?: boolean };
}

/**
 * Secretary triage of public player enquiries (#73). Moving one to
 * Registered or Declined deletes its contact details on the server.
 */
export function EnquiriesTab({ clubSlug }: { clubSlug: string }) {
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Ref for a synchronous double-click guard; state so the controls disable.
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const load = useCallback(async (offset = 0, append = false) => {
    try {
      const data = await fetchPage(clubSlug, offset);
      setItems((prev) => (append && prev ? [...prev, ...data.items] : data.items));
      setHasMore(!!data.hasMore);
    } catch (e) {
      captureError(e, { source: 'enquiries load' });
      setError('Could not load enquiries.');
      // Keep previous rows so a transient failure does not look like an empty inbox.
      if (!append) setItems((prev) => prev ?? []);
    }
  }, [clubSlug]);

  useEffect(() => { void load(); }, [load]);

  // Re-fetch from the top until the already-loaded window is covered, so a resync keeps appended pages.
  const resync = async (count: number) => {
    try {
      let rows: Enquiry[] = [];
      let more = true;
      while (more) {
        const data = await fetchPage(clubSlug, rows.length);
        rows = [...rows, ...data.items];
        more = !!data.hasMore;
        if (rows.length >= count || data.items.length === 0) break;
      }
      setItems(rows);
      setHasMore(more);
    } catch (e) {
      captureError(e, { source: 'enquiries load' });
      setError('Could not load enquiries.');
    }
  };

  const mutate = async (id: string, init: RequestInit, url = '/api/admin/enquiries') => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPendingIds(new Set(pendingRef.current));
    setError(null);
    let ok = false;
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug } });
      ok = res.ok;
      if (!ok) setError('That change did not save.');
    } catch (e) {
      captureError(e, { source: 'enquiries mutate' });
      setError('That change did not save.');
    } finally {
      pendingRef.current.delete(id);
      setPendingIds(new Set(pendingRef.current));
    }
    if (!ok) {
      // Server state is unknown (e.g. closed elsewhere): resync without dropping appended pages.
      await resync(itemsRef.current?.length ?? 0);
      return;
    }
    // Apply the change in place so rows from later pages stay on screen.
    if (init.method === 'DELETE') {
      setItems((prev) => prev && prev.filter((e) => e.id !== id));
      return;
    }
    const { status } = JSON.parse(String(init.body)) as { status: string };
    const closed = TERMINAL_STATUSES.includes(status);
    setItems((prev) => prev && prev.map((e) => (e.id !== id ? e : closed
      ? { ...e, status, contactName: null, contactEmail: null, contactPhone: null, playerFirstName: null, contactPurgedAt: e.contactPurgedAt ?? Date.now() }
      : { ...e, status })));
  };

  const loadMore = async () => {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(items.length, true);
    } finally {
      setLoadingMore(false);
    }
  };

  if (items === null) return <Center h={120}><Loader /></Center>;

  return (
    <>
      {error && <Alert color="red" variant="light" mb="sm">{error}</Alert>}
      {items.length === 0 && !error ? (
        <Text c="dimmed" size="sm">No enquiries yet. They arrive from the form on your Registration page.</Text>
      ) : items.length === 0 ? null : (
        <>
          <Table.ScrollContainer minWidth={720}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Received</Table.Th><Table.Th>Age group</Table.Th><Table.Th>Contact</Table.Th>
                  <Table.Th>Player</Table.Th><Table.Th>Status</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((e) => {
                  const busy = pendingIds.has(e.id);
                  return (
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
                          disabled={busy}
                          onChange={(ev) => void mutate(e.id, { method: 'PATCH', body: JSON.stringify({ id: e.id, status: ev.currentTarget.value }) })}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Delete enquiry">
                          <ActionIcon variant="subtle" color="red" aria-label="Delete enquiry" disabled={busy}
                            onClick={() => void mutate(e.id, { method: 'DELETE' }, `/api/admin/enquiries?id=${encodeURIComponent(e.id)}`)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {hasMore && (
            <Button mt="sm" size="xs" variant="light" loading={loadingMore} onClick={() => void loadMore()}>
              Load more
            </Button>
          )}
        </>
      )}
    </>
  );
}
