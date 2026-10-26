import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, List, Progress, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconCircleDashed, IconListCheck } from '@tabler/icons-react';
import { useClub } from '../../context/ClubContext';
import { captureEvent } from '../../lib/posthog';
import type { OnboardingStep } from '../../utils/onboarding';

interface Props {
  steps: OnboardingStep[];
}

const dismissKey = (clubSlug: string) => `onboardingChecklistDismissed:${clubSlug}`;

function readDismissed(clubSlug: string): boolean {
  try {
    return localStorage.getItem(dismissKey(clubSlug)) === '1';
  } catch {
    return false;
  }
}

/**
 * Setup checklist on Customise for a club that is not ready yet (#85).
 *
 * Completion comes from the club's data via onboardingSteps(); the only thing
 * stored is the admin's choice to dismiss it, per club, in this browser.
 * Once every step is done, or it is dismissed, it renders nothing.
 */
export function OnboardingChecklist({ steps }: Props) {
  const { clubSlug } = useClub();
  const [dismissed, setDismissed] = useState(() => readDismissed(clubSlug));
  const seen = useRef<Map<string, boolean> | null>(null);

  // A step that flips from not done to done during this visit is reported
  // once. Steps already done on first render are not, so reloading the page
  // does not re-send them.
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Map(steps.map(s => [s.id, s.done]));
      return;
    }
    for (const step of steps) {
      if (step.done && seen.current.get(step.id) === false) {
        captureEvent('onboarding step completed', { club_slug: clubSlug, step: step.id });
      }
      seen.current.set(step.id, step.done);
    }
  }, [steps, clubSlug]);

  const doneCount = steps.filter(s => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(clubSlug), '1');
    } catch {
      // Storage unavailable: still hide it for this visit.
    }
    captureEvent('onboarding checklist dismissed', { club_slug: clubSlug, done_count: doneCount });
    setDismissed(true);
  };

  return (
    <Alert variant="light" color="blue" radius="md" icon={<IconListCheck size={18} />}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text fw={700} size="sm">Get your club site ready</Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">{doneCount} of {steps.length} done</Text>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={dismiss}>
              Hide checklist
            </Button>
          </Group>
        </Group>
        <Progress value={(doneCount / steps.length) * 100} size="sm" radius="xl" aria-label="Setup progress" />
        <List spacing={4} size="sm" center>
          {steps.map(step => (
            <List.Item
              key={step.id}
              data-testid={`onboarding-step-${step.id}`}
              data-done={step.done ? 'true' : 'false'}
              icon={
                <ThemeIcon size={18} radius="xl" color={step.done ? 'green' : 'gray'} variant={step.done ? 'filled' : 'light'}>
                  {step.done ? <IconCheck size={12} /> : <IconCircleDashed size={12} />}
                </ThemeIcon>
              }
            >
              <Text size="sm" td={step.done ? 'line-through' : undefined} c={step.done ? 'dimmed' : undefined} span>
                {step.label}
              </Text>
              {!step.done && <Text size="xs" c="dimmed" span> ({step.hint})</Text>}
            </List.Item>
          ))}
        </List>
        <Stack gap={2}>
          <Text size="xs" fw={600}>Also worth doing</Text>
          <Text size="xs" c="dimmed">
            Add a second admin to your WhatsApp Channel. A Channel belongs to one person's WhatsApp
            account, so if that person steps down without handing over, the club loses it. Co-admins
            can see each other's phone numbers; followers cannot.
          </Text>
          <Text size="xs" c="dimmed">
            Register with the ICO. Clubs that handle personal data usually need to pay the data
            protection fee.
          </Text>
        </Stack>
      </Stack>
    </Alert>
  );
}
