import { useCallback, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Center, Group, Loader, Modal, Radio, Stack, Text, Textarea,
} from '@mantine/core';
import {
  IconArrowsJoin, IconClipboardList, IconFileSpreadsheet, IconFileUpload,
} from '@tabler/icons-react';
import { captureEvent } from '../../lib/posthog';
import { getSubscriptionStatus } from '../../utils/subscriptionStatus';
import { ClubFilterBar } from './ClubFilterBar';
import { EmptyState } from './EmptyState';
import { RegistrationsSummary } from './RegistrationsSummary';
import { RegistrationsTable } from './RegistrationsTable';
import { exportRegistrationsToXlsx } from './exportRegistrations';
import { useClubRegistrations } from './useClubRegistrations';
import { ExportTooLargeError, useAllClubRegistrations } from './useAllClubRegistrations';
import { ALL, MAX_MERGE_SELECTION, type RegistrationRow, type SubscriptionLevel } from './types';

/**
 * The club tab: one page of registrations, plus everything that acts on them.
 *
 * Lifted out of RegistrationsPage so the page is left orchestrating two tabs
 * rather than holding twenty pieces of state that only one of them uses.
 */

interface ClubRegistrationsTabProps {
  clubSlug: string;
  levels: SubscriptionLevel[];
  onOpenImport: () => void;
  onOpenReport: (loadRows: () => Promise<RegistrationRow[]>, faFilter: {
    team: string | null; registrationStatus: string | null; dropFaOnly: boolean;
  }, filtersActive: boolean) => void;
  /** Bumped by the page when an import lands, to force a reload. */
  reloadToken: number;
}

export function ClubRegistrationsTab({
  clubSlug, levels, onOpenImport, onOpenReport, reloadToken,
}: ClubRegistrationsTabProps) {
  const club = useClubRegistrations(clubSlug, true, reloadToken);
  const { loadAll, progress: exportProgress, running: exporting } = useAllClubRegistrations(clubSlug);

  const [updatingLevelId, setUpdatingLevelId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState('');
  const [pendingManual, setPendingManual] = useState<RegistrationRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);
  const [manualError, setManualError] = useState('');
  const [unmarkPaidError, setUnmarkPaidError] = useState('');
  const [exportError, setExportError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RegistrationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /**
   * The rows picked for merging, held whole rather than by id.
   *
   * A `Set` of ids resolved against the loaded rows would empty the moment the
   * admin turned the page: the ticks would survive but the derived rows would
   * not, so the blocker would claim nothing was selected while the checkboxes
   * said otherwise.
   */
  const [selectedForMerge, setSelectedForMerge] = useState<Map<string, RegistrationRow>>(new Map());
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergePrimaryId, setMergePrimaryId] = useState<string | null>(null);
  const [mergeBusyId, setMergeBusyId] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState('');

  const filtersActive =
    club.filters.team !== ALL
    || club.filters.status !== ALL
    || club.filters.subscription !== ALL
    || club.search.trim() !== '';

  const handleLevelChange = useCallback(async (row: RegistrationRow, levelId: string | null) => {
    setUpdatingLevelId(row.registrationId);
    setLevelError('');
    const previous = {
      overrideLevelId: row.overrideLevelId,
      subscriptionLevelId: row.subscriptionLevelId,
      subscriptionLevelName: row.subscriptionLevelName,
    };
    const newName = levelId ? (levels.find(l => l.id === levelId)?.name ?? null) : null;

    club.patchRow(row.registrationId, {
      overrideLevelId: levelId,
      subscriptionLevelId: levelId ?? row.subscriptionLevelId,
      subscriptionLevelName: levelId ? newName : row.subscriptionLevelName,
    });

    try {
      const res = await fetch('/api/admin/registration-subscription-levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({ registrationId: row.registrationId, subscriptionLevelId: levelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to update subscription level');
      }
      // Re-reads the current page, not page 1: the row just edited is on screen
      // and sending the admin back to the start would lose it.
      club.refresh();
    } catch (e) {
      setLevelError(e instanceof Error ? e.message : 'Failed to update subscription level');
      club.patchRow(row.registrationId, previous);
    } finally {
      setUpdatingLevelId(null);
    }
  }, [clubSlug, levels, club]);

  const openManualModal = useCallback((row: RegistrationRow) => {
    setManualNote('');
    setManualError('');
    setPendingManual(row);
  }, []);

  const closeManualModal = () => {
    if (manualBusyId) return;
    setPendingManual(null);
    setManualNote('');
    setManualError('');
  };

  const handleConfirmMarkPaid = async () => {
    if (!pendingManual) return;
    setManualBusyId(pendingManual.registrationId);
    setManualError('');
    try {
      const res = await fetch('/api/admin/manual-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({
          registrationId: pendingManual.registrationId,
          ...(manualNote.trim() ? { note: manualNote.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to mark as paid');
      }
      setPendingManual(null);
      setManualNote('');
      // Refresh rather than patch locally — the server owns the attribution
      // (who/when) shown in the badge tooltip.
      club.refresh();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Failed to mark as paid');
    } finally {
      setManualBusyId(null);
    }
  };

  const handleUnmarkPaid = useCallback(async (row: RegistrationRow) => {
    setManualBusyId(row.registrationId);
    setUnmarkPaidError('');
    try {
      const res = await fetch(
        `/api/admin/manual-payment?registrationId=${encodeURIComponent(row.registrationId)}`,
        { method: 'DELETE', headers: { 'X-Club-Slug': clubSlug } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to remove the manual override');
      }
      club.refresh();
    } catch (e) {
      setUnmarkPaidError(e instanceof Error ? e.message : 'Failed to remove the manual override');
    } finally {
      setManualBusyId(null);
    }
  }, [clubSlug, club]);

  const selectedRows = useMemo(() => [...selectedForMerge.values()], [selectedForMerge]);

  /** Why the selection cannot merge, mirroring the API so the admin sees it before a 409. */
  const mergeBlocker = useMemo((): string | null => {
    if (selectedRows.length < 2) {
      // Naming the search is the whole mitigation for a group split across
      // pages: one player's registrations rarely sort adjacently.
      return 'Select two or more registrations to merge. Searching a FAN ID brings one player‘s registrations onto a single page.';
    }
    if (selectedRows.length > MAX_MERGE_SELECTION) {
      return `A billing group can hold at most ${MAX_MERGE_SELECTION} registrations.`;
    }
    if (new Set(selectedRows.map(r => r.fanId)).size > 1) {
      return 'Registrations can only be merged for one player at a time.';
    }
    const alreadyMerged = selectedRows.find(r => r.billedWithTeamName || r.mergedTeamNames);
    if (alreadyMerged) {
      return `${alreadyMerged.teamName} is already part of a billing group. Unmerge it first.`;
    }
    return null;
  }, [selectedRows]);

  const toggleMergeSelection = useCallback((registrationId: string) => {
    setMergeError('');
    setSelectedForMerge(prev => {
      const next = new Map(prev);
      if (next.has(registrationId)) next.delete(registrationId);
      else {
        const row = club.rows.find(r => r.registrationId === registrationId);
        if (row) next.set(registrationId, row);
      }
      return next;
    });
  }, [club.rows]);

  const openMergeModal = () => {
    // Level first, then paid, then whatever is first — the primary prices the
    // group, so one without a level would render a dead card.
    const preferred =
      selectedRows.find(r => r.subscriptionLevelId && r.paymentStatus)
      ?? selectedRows.find(r => r.subscriptionLevelId)
      ?? selectedRows[0];
    setMergePrimaryId(preferred?.registrationId ?? null);
    setMergeError('');
    setMergeModalOpen(true);
  };

  const handleConfirmMerge = async () => {
    if (!mergePrimaryId || selectedRows.length < 2) return;
    setMergeBusyId(mergePrimaryId);
    setMergeError('');
    try {
      const res = await fetch('/api/admin/registration-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug },
        body: JSON.stringify({
          primaryRegistrationId: mergePrimaryId,
          registrationIds: selectedRows.map(r => r.registrationId),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to merge registrations');
      }
      captureEvent('registrations merged', { club_slug: clubSlug, group_size: selectedRows.length });
      setMergeModalOpen(false);
      setSelectedForMerge(new Map());
      // Refresh, not patch: the server owns the grouping and the whole group's
      // payment status moves with it.
      club.refresh();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Failed to merge registrations');
    } finally {
      setMergeBusyId(null);
    }
  };

  const handleUnmerge = async (row: RegistrationRow) => {
    setMergeBusyId(row.registrationId);
    setMergeError('');
    try {
      const res = await fetch(
        `/api/admin/registration-merges?primaryRegistrationId=${encodeURIComponent(row.registrationId)}`,
        { method: 'DELETE', headers: { 'X-Club-Slug': clubSlug } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to unmerge registrations');
      }
      captureEvent('registrations unmerged', { club_slug: clubSlug });
      club.refresh();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Failed to unmerge registrations');
    } finally {
      setMergeBusyId(null);
    }
  };

  /**
   * Every row matching the current filters.
   *
   * Both the export and the FA report need the whole filtered set, not the page
   * on screen, or each silently narrows to whatever happens to be visible.
   */
  const loadFilteredRows = useCallback(
    () => loadAll(club.filters, club.search),
    [loadAll, club.filters, club.search],
  );

  const handleExport = async () => {
    setExportError('');
    try {
      const rows = await loadFilteredRows();
      exportRegistrationsToXlsx(rows, clubSlug, club.filters);
      captureEvent('registrations exported', {
        club_slug: clubSlug,
        row_count: rows.length,
        filtered: filtersActive,
        capped: false,
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Failed to export registrations');
      if (e instanceof ExportTooLargeError) {
        captureEvent('registrations exported', {
          club_slug: clubSlug,
          row_count: 0,
          filtered: filtersActive,
          capped: true,
        });
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(
        `/api/my-registrations?registrationId=${encodeURIComponent(pendingDelete.registrationId)}`,
        { method: 'DELETE', headers: { 'X-Club-Slug': clubSlug } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Delete failed');
      }
      // Drop it locally rather than refetching: the rest of the page is still
      // valid, and a refetch would pull a row forward from the next page.
      club.removeRow(pendingDelete.registrationId);
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError('');
  };

  const openReport = () => onOpenReport(
    loadFilteredRows,
    {
      team: club.filters.team !== ALL ? club.filters.team : null,
      registrationStatus: club.filters.status !== ALL ? club.filters.status : null,
      dropFaOnly: club.filters.subscription !== ALL || club.search.trim() !== '',
    },
    filtersActive,
  );

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <ClubFilterBar
          facets={club.facets}
          filters={club.filters}
          onChange={club.setFilters}
          search={club.search}
          onSearch={club.setSearch}
        />
        <Group gap="xs" wrap="wrap">
          <Button
            leftSection={<IconFileUpload size={16} />}
            onClick={onOpenImport}
            radius="xl"
            variant="light"
            size="xs"
          >
            Import Players
          </Button>
          {/* Never disabled: with no registrations the report is all "No subs record". */}
          <Button
            leftSection={<IconClipboardList size={16} />}
            onClick={openReport}
            radius="xl"
            variant="light"
            size="xs"
          >
            Generate status report
          </Button>
          <Button
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={handleExport}
            radius="xl"
            variant="light"
            size="xs"
            loading={exporting}
          >
            {/* Rows, not pages: the export walks the whole filtered set, and a
                page counter would mean nothing to the person watching. */}
            {exporting ? `Exporting ${exportProgress}…` : 'Export to Excel'}
          </Button>
        </Group>
      </Group>

      {exportError && <Alert color="red" variant="light">{exportError}</Alert>}

      {selectedForMerge.size > 0 && (
        <Group
          justify="space-between"
          wrap="wrap"
          gap="xs"
          p="xs"
          style={{
            background: 'var(--mantine-color-indigo-0)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Text size="sm">
            {selectedForMerge.size} selected
            {mergeBlocker && <Text span size="sm" c="dimmed"> — {mergeBlocker}</Text>}
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => setSelectedForMerge(new Map())}>
              Clear
            </Button>
            <Button
              size="xs"
              radius="xl"
              leftSection={<IconArrowsJoin size={16} />}
              disabled={mergeBlocker !== null}
              onClick={openMergeModal}
            >
              Merge registrations
            </Button>
          </Group>
        </Group>
      )}

      {levelError && <Alert color="red" variant="light">{levelError}</Alert>}
      {unmarkPaidError && <Alert color="red" variant="light">{unmarkPaidError}</Alert>}
      {mergeError && <Alert color="red" variant="light">{mergeError}</Alert>}
      {club.error && <Alert color="red" variant="light">{club.error}</Alert>}

      {/* Counts cover the whole filtered set, so they keep their meaning as the
          admin pages through it. */}
      {club.summaryLoading && !club.summary
        ? <Center h={72}><Loader size="sm" /></Center>
        : club.summary && (filtersActive || club.summary.registrations > 0)
          // Zeroes are meaningful when a filter produced them, and noise on a
          // club that has never imported anyone.
          && <RegistrationsSummary summary={club.summary} />}

      {club.loading ? (
        <Center h={160}><Loader /></Center>
      ) : club.rows.length === 0 ? (
        filtersActive
          ? <Text size="sm" c="dimmed">No registrations match the current filters.</Text>
          : <EmptyState isAdmin scope="club" />
      ) : (
        <RegistrationsTable
          rows={club.rows}
          sixthHeader="Linked accounts"
          canDelete
          onDelete={setPendingDelete}
          serverSort={{ sort: club.sort, onSort: club.setSort }}
          editableLevels={{ levels, updatingId: updatingLevelId, onChange: handleLevelChange }}
          merge={{
            selectedIds: new Set(selectedForMerge.keys()),
            onToggle: toggleMergeSelection,
            onUnmerge: handleUnmerge,
            busyId: mergeBusyId,
          }}
          manualPayment={{
            busyId: manualBusyId,
            onMark: openManualModal,
            onUnmark: handleUnmarkPaid,
          }}
        />
      )}

      {(club.hasPrev || club.hasNext) && (
        <Group justify="space-between" align="center">
          {/* No total: a COUNT over the filtered set is the full scan this page
              exists to escape, so the position is all there is to show. */}
          <Text size="sm" c="dimmed">Page {club.page}</Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              radius="xl"
              disabled={!club.hasPrev || club.loading}
              onClick={club.goPrev}
            >
              Previous
            </Button>
            <Button
              size="xs"
              variant="default"
              radius="xl"
              disabled={!club.hasNext || club.loading}
              onClick={club.goNext}
            >
              Next
            </Button>
          </Group>
        </Group>
      )}

      <Modal
        opened={pendingManual !== null}
        onClose={closeManualModal}
        title="Mark as paid"
        size="sm"
        centered
      >
        {pendingManual && (
          <Stack>
            {manualError && <Alert color="red" variant="light">{manualError}</Alert>}
            <Text size="sm">
              Mark <strong>{pendingManual.fanId}</strong> ({pendingManual.teamName}) as
              paid up for subs? They will show as <strong>Paid in full</strong> and will
              not be asked to set up a Direct Debit.
            </Text>
            <Textarea
              label="Note (optional)"
              placeholder="e.g. cash at training 12 Aug, bank transfer ref 4471"
              value={manualNote}
              onChange={e => setManualNote(e.currentTarget.value)}
              rows={3}
              radius="md"
            />
            <Text size="xs" c="dimmed">
              Your name and the time are recorded against this override for audit.
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                radius="xl"
                onClick={closeManualModal}
                disabled={manualBusyId !== null}
              >
                Cancel
              </Button>
              <Button
                color="green"
                radius="xl"
                onClick={handleConfirmMarkPaid}
                loading={manualBusyId !== null}
              >
                Mark as paid
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={pendingDelete !== null}
        onClose={closeDeleteModal}
        title="Remove registration"
        size="sm"
        centered
      >
        {pendingDelete && (
          <Stack>
            {deleteError && <Alert color="red" variant="light">{deleteError}</Alert>}
            <Text size="sm">
              Remove <strong>{pendingDelete.fanId}</strong> from{' '}
              <strong>{pendingDelete.teamName}</strong>? This deletes the registration
              and any linked payment records and cannot be undone.
            </Text>
            {pendingDelete.mergedTeamNames && (
              <Alert color="orange" variant="light">
                This registration is what{' '}
                <strong>{pendingDelete.mergedTeamNames}</strong> {' '}
                {pendingDelete.mergedTeamNames.includes(',') ? 'are' : 'is'} billed
                through. Removing it takes the group&rsquo;s payment record with it and
                leaves them unpaid — unmerge first.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" radius="xl" onClick={closeDeleteModal} disabled={deleting}>
                Cancel
              </Button>
              <Button color="red" radius="xl" onClick={handleConfirmDelete} loading={deleting}>
                Remove
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={mergeModalOpen}
        onClose={() => { if (!mergeBusyId) setMergeModalOpen(false); }}
        title="Merge registrations"
        size="md"
        centered
      >
        <Stack>
          {mergeError && <Alert color="red" variant="light">{mergeError}</Alert>}
          <Text size="sm">
            These registrations will be billed as one payment. Choose which one the
            payment hangs off — its subscription level prices the whole group, and its
            team name is what appears on the Direct Debit.
          </Text>
          <Radio.Group value={mergePrimaryId ?? ''} onChange={setMergePrimaryId}>
            <Stack gap="xs">
              {selectedRows.map(r => (
                <Radio
                  key={r.registrationId}
                  value={r.registrationId}
                  label={
                    <Box>
                      <Text size="sm" fw={600}>{r.teamName}</Text>
                      <Text size="xs" c={r.subscriptionLevelName ? 'dimmed' : 'orange'}>
                        {r.subscriptionLevelName ?? 'No subscription level assigned'}
                        {r.paymentStatus && ` · ${getSubscriptionStatus(r).label}`}
                      </Text>
                    </Box>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>
          <Text size="xs" c="dimmed">
            The other registrations keep their own level on record; it just stops being
            charged. You can unmerge at any time before a payment is set up.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              radius="xl"
              onClick={() => setMergeModalOpen(false)}
              disabled={mergeBusyId !== null}
            >
              Cancel
            </Button>
            <Button
              radius="xl"
              onClick={handleConfirmMerge}
              loading={mergeBusyId !== null}
              disabled={!mergePrimaryId}
            >
              Merge
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
