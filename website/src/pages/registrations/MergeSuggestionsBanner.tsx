import { useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconArrowsJoin } from '@tabler/icons-react';
import type { DismissedSuggestion, MergeSuggestionSet } from './useMergeSuggestions';

/**
 * Registrations of one player, in one age group, billed separately.
 *
 * A banner rather than a panel: the busiest club we have has 18 of these, which
 * is not a list to work down. It states the club's count, not the loaded page's
 * — the whole reason the grouping moved to the server.
 *
 * Every set carries a way to say no, because the hint has no judgement: U18 Blue
 * and U18 Purple share an age group and are genuinely two sets of subs, and
 * without a memory the suggester would repeat that after every import. The
 * dismissals stay visible and undoable underneath, because a suppression list
 * nobody can see is a support ticket waiting to happen.
 *
 * Sections are conditionally rendered rather than collapsed, so what is on
 * screen is what is in the DOM.
 *
 * A suggestions read that fails takes the banner with it silently, the way the
 * facets and the summary strip already do: this is a hint over the table, and a
 * hint that cannot load has nothing to say. The failure is still recorded —
 * `useMergeSuggestions` reports it through `captureError`. What is never silent
 * is a *write*: a dismissal or a restore that fails says so, next to the set it
 * belongs to, because the admin has just made a decision and needs to know it
 * did not land.
 */

interface MergeSuggestionsBannerProps {
  suggestions: MergeSuggestionSet[];
  dismissed: DismissedSuggestion[];
  openCount: number;
  dismissedCount: number;
  /** The endpoint had more than one page; the list below is the first of them. */
  truncated: boolean;
  dismissedLoading: boolean;
  reviewing: boolean;
  onToggleReview: () => void;
  onLoadDismissed: () => void;
  onDismiss: (playerId: string, ageGroup: string) => Promise<void>;
  onRestore: (playerId: string, ageGroup: string) => Promise<void>;
}

export function MergeSuggestionsBanner({
  suggestions, dismissed, openCount, dismissedCount, truncated, dismissedLoading,
  reviewing, onToggleReview, onLoadDismissed, onDismiss, onRestore,
}: MergeSuggestionsBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // Nothing suggested and nothing dismissed is nothing to say.
  if (openCount === 0 && dismissedCount === 0) return null;

  const act = async (key: string, run: () => Promise<void>) => {
    setBusyKey(key);
    setActionError('');
    try {
      await run();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleDismissed = () => {
    if (!showDismissed) onLoadDismissed();
    setShowDismissed(v => !v);
  };

  return (
    <Alert color="indigo" variant="light" icon={<IconArrowsJoin size={18} />}>
      <Stack gap="xs">
        {openCount > 0 && (
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm">
              {openCount === 1
                ? '1 player has registrations in the same age group that are billed separately.'
                : `${openCount} players have registrations in the same age group that are billed separately.`}
              {' '}
              <Text span size="sm" c="dimmed">
                They may be one set of subs — or genuinely separate. Only you can tell.
              </Text>
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                radius="xl"
                onClick={() => setExpanded(v => !v)}
              >
                {expanded ? 'Hide the list' : 'List them'}
              </Button>
              <Button
                size="xs"
                radius="xl"
                variant={reviewing ? 'filled' : 'light'}
                onClick={onToggleReview}
              >
                {reviewing ? 'Show all' : 'Review them'}
              </Button>
            </Group>
          </Group>
        )}

        {actionError && <Text size="sm" c="red">{actionError}</Text>}

        {expanded && openCount > 0 && (
          <Stack gap={4}>
            {suggestions.map((s) => {
              const key = `${s.playerId}\u0000${s.ageGroup}`;
              return (
                <Group key={key} justify="space-between" wrap="wrap" gap="xs">
                  <Text size="sm">
                    {s.fanId} · {s.ageGroup}
                    {' '}
                    <Text span size="sm" c="dimmed">{s.teamNames.join(', ')}</Text>
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    loading={busyKey === key}
                    onClick={() => act(key, () => onDismiss(s.playerId, s.ageGroup))}
                  >
                    Not the same subs
                  </Button>
                </Group>
              );
            })}
            {truncated && (
              <Text size="sm" c="dimmed">
                Showing the first {suggestions.length}. Review them to work through the rest.
              </Text>
            )}
          </Stack>
        )}

        {dismissedCount > 0 && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {dismissedCount === 1
                ? '1 suggestion dismissed.'
                : `${dismissedCount} suggestions dismissed.`}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={toggleDismissed}>
              {showDismissed ? 'Hide them' : 'Review dismissed'}
            </Button>
          </Group>
        )}

        {showDismissed && (
          <Stack gap={4}>
            {dismissedLoading && <Text size="sm" c="dimmed">Loading …</Text>}
            {!dismissedLoading && dismissed.length === 0 && (
              <Text size="sm" c="dimmed">Nothing dismissed.</Text>
            )}
            {dismissed.map((d) => {
              const key = `dismissed:${d.playerId}\u0000${d.ageKey}`;
              return (
                <Group key={key} justify="space-between" wrap="wrap" gap="xs">
                  <Text size="sm" c="dimmed">
                    {d.fanId} · {d.ageGroup} · {d.setSize} registrations
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    loading={busyKey === key}
                    onClick={() => act(key, () => onRestore(d.playerId, d.ageGroup))}
                  >
                    Restore
                  </Button>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Alert>
  );
}
