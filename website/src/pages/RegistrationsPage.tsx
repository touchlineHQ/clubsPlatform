import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Center, Loader, Modal, Stack, Text, Tabs, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { PageHeader } from '../components/club/PageHeader';
import { useClub } from '../context/ClubContext';
import { ImportPlayersPanel } from './admin-users/ImportPlayersPanel';
import { StatusReportPanel } from './registrations/StatusReportPanel';
import { captureError, captureEvent } from '../lib/posthog';
import { timeAgo } from '../utils/timeAgo';
import { summariseRegistrations } from '../utils/registrationSummary';
import { EmptyState } from './registrations/EmptyState';
import { RegistrationsSummary } from './registrations/RegistrationsSummary';
import { RegistrationsTable } from './registrations/RegistrationsTable';
import { ClubRegistrationsTab } from './registrations/ClubRegistrationsTab';
import type { RegistrationRow, SubscriptionLevel } from './registrations/types';

interface PersonalResponse {
  personal: RegistrationRow[];
  scope: 'admin' | 'user';
  lastImportedAt: number | null;
}

/**
 * A failed registrations load, carrying enough to say what failed.
 *
 * #107 and #93 were both filed from a bare `!res.ok` that read neither the
 * status nor the body, so the only thing that reached PostHog was the string
 * "Failed to load registrations" — which named no cause and got #93 closed as
 * `not_planned` before it recurred.
 */
class RegistrationsLoadError extends Error {
  constructor(readonly context: { status: number; read: string | null; body: string | null }) {
    super('Failed to load registrations');
    this.name = 'RegistrationsLoadError';
  }
}

/** How much of an unrecognised error body to keep. Enough to identify it. */
const ERROR_BODY_CHARS = 200;

/**
 * Reads what a failed response can tell us.
 *
 * Two shapes matter and they mean different things. The API answers with
 * `{ error, read }`, where `read` names the query that died. A Worker killed by
 * a CPU or subrequest limit never reaches that code at all — the edge answers
 * instead, with HTML — so a body that will not parse is itself the signal, and
 * the status is the only thing distinguishing the cases. Neither carries
 * personal data, and the snippet is truncated regardless.
 */
async function describeFailure(res: globalThis.Response): Promise<RegistrationsLoadError> {
  const text = await res.text().catch(() => '');
  let read: string | null = null;
  let body: string | null = text ? text.slice(0, ERROR_BODY_CHARS) : null;

  try {
    const parsed = JSON.parse(text) as { read?: string } | null;
    if (typeof parsed?.read === 'string') {
      read = parsed.read;
      body = null; // Recognised and understood; the label is the useful part.
    }
    // JSON without a `read` is still ours — the 400 for a missing club header,
    // the 403 for a club mismatch, the 401 from requireAuth. Its `error` text is
    // the only evidence those give, so the snippet has to survive.
  } catch {
    // Not our JSON — an edge error page. Keep the snippet; it names the limit.
  }

  return new RegistrationsLoadError({ status: res.status, read, body });
}

/** Display personal or club registrations and the latest player-import time. */
export function RegistrationsPage() {
  const { clubSlug } = useClub();
  const [personal, setPersonal] = useState<RegistrationRow[]>([]);
  const [scope, setScope] = useState<'admin' | 'user'>('user');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastImportedAt, setLastImportedAt] = useState<number | null>(null);
  const [levels, setLevels] = useState<SubscriptionLevel[]>([]);

  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);
  const [reportOpened, { open: openReport, close: closeReport }] = useDisclosure(false);
  const [report, setReport] = useState<{
    loadRows: () => Promise<RegistrationRow[]>;
    faFilter: { team: string | null; registrationStatus: string | null; dropFaOnly: boolean };
    filtersActive: boolean;
  } | null>(null);

  /** Bumped after an import, so the club tab reloads a set that has changed. */
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Reload the personal registrations and the import timestamp.
   *
   * /api/my-registrations no longer returns the club's rows: those come from
   * /api/admin/registrations one page at a time. It keeps `personal`, `scope`
   * and `lastImportedAt`, all of which are bounded.
   */
  const refreshPersonal = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/my-registrations', {
        headers: { 'X-Club-Slug': clubSlug },
      });
      if (!res.ok) throw await describeFailure(res);
      const data = await res.json() as Partial<PersonalResponse>;
      // Defaulted, not trusted: the page reads `personal.length` directly, so a
      // missing field would white-screen the table rather than show an error.
      setPersonal(data.personal ?? []);
      setScope(data.scope ?? 'user');
      setLastImportedAt(data.lastImportedAt ?? null);
    } catch (e) {
      captureError(e, {
        op: 'registrations.refresh',
        ...(e instanceof RegistrationsLoadError ? e.context : { status: null, read: null }),
      });
      setError('Failed to load registrations');
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => { refreshPersonal(); }, [refreshPersonal]);

  const isAdmin = scope === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/subscription-levels', {
          headers: { 'X-Club-Slug': clubSlug },
        });
        if (!res.ok) return;
        const data = await res.json() as { levels?: SubscriptionLevel[] };
        if (!cancelled) setLevels(Array.isArray(data.levels) ? data.levels : []);
      } catch {
        // Non-fatal — the Select will just be disabled.
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, clubSlug]);

  const personalSummary = useMemo(() => summariseRegistrations(personal), [personal]);

  /** Close the import dialog and reload everything it could have changed. */
  const handleImported = () => {
    closeImport();
    refreshPersonal();
    setReloadToken(t => t + 1);
  };

  const handleOpenReport = useCallback((
    loadRows: () => Promise<RegistrationRow[]>,
    faFilter: { team: string | null; registrationStatus: string | null; dropFaOnly: boolean },
    filtersActive: boolean,
  ) => {
    setReport({ loadRows, faFilter, filtersActive });
    openReport();
  }, [openReport]);

  const personalContent = personal.length === 0
    ? <EmptyState isAdmin={isAdmin} scope="personal" />
    : (
      <Stack gap="sm">
        <RegistrationsSummary summary={personalSummary} />
        <RegistrationsTable rows={personal} sixthHeader="Relationship" canDelete={false} />
      </Stack>
    );

  return (
    <Stack maw={1000} mx="auto" gap="lg">
      <PageHeader
        title="Registrations"
        subtitle={isAdmin
          ? 'Your linked registrations, plus all registrations across the club.'
          : 'Player registrations linked to your account.'}
        below={isAdmin ? (
          <Box px={{ base: 'md', sm: 'xl' }} py="xs">
            <Text size="xs" c="dimmed">
              {lastImportedAt === null ? (
                'Player data has never been imported.'
              ) : (
                <Tooltip label={new Date(lastImportedAt).toLocaleString()} withArrow>
                  <span>Player data last imported {timeAgo(lastImportedAt)}</span>
                </Tooltip>
              )}
            </Text>
          </Box>
        ) : undefined}
      />

      {error && <Alert color="red" variant="light">{error}</Alert>}

      {loading ? (
        <Center h={160}><Loader /></Center>
      ) : isAdmin ? (
        <Tabs defaultValue="mine" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="mine">My Registrations</Tabs.Tab>
            <Tabs.Tab value="club">Club Registrations</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="mine" pt="lg">{personalContent}</Tabs.Panel>
          <Tabs.Panel value="club" pt="lg">
            {/* keepMounted={false} above, so this unmounts on tab switch and its
                cursor resets to page 1. Cheap, and it avoids showing a position
                minted before an import landed. */}
            <ClubRegistrationsTab
              clubSlug={clubSlug}
              levels={levels}
              onOpenImport={openImport}
              onOpenReport={handleOpenReport}
              reloadToken={reloadToken}
            />
          </Tabs.Panel>
        </Tabs>
      ) : (
        personalContent
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

      <Modal
        opened={reportOpened}
        onClose={closeReport}
        title="Generate status report"
        size="xl"
        radius="md"
      >
        {report && (
          <StatusReportPanel
            loadRegistrations={report.loadRows}
            faFilter={report.faFilter}
            clubSlug={clubSlug}
            filtersActive={report.filtersActive}
          />
        )}
      </Modal>
    </Stack>
  );
}
