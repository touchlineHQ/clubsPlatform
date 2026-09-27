import { Checkbox, Stack, Text, Title } from '@mantine/core';

export type EmailSignoffLiability = {
  id: string;
  title: string;
  wording: string;
  wordingHash: string;
};

export type EmailSignoffTicks = Record<string, boolean>;

interface Props {
  liabilities: EmailSignoffLiability[];
  ticks: EmailSignoffTicks;
  onChange: (ticks: EmailSignoffTicks) => void;
  /** When set, those liabilities are already held and stay locked on. */
  lockedIds?: string[];
  disabled?: boolean;
}

/**
 * Three independent liability ticks for club contact-email collection (#130).
 * Deliberately no "accept all" control — each must be evidenced separately.
 */
export function EmailSignoffCheckboxes({
  liabilities,
  ticks,
  onChange,
  lockedIds = [],
  disabled = false,
}: Props) {
  const locked = new Set(lockedIds);

  return (
    <Stack gap="md">
      {liabilities.map((liability) => {
        const isLocked = locked.has(liability.id);
        return (
          <Stack key={liability.id} gap={6}>
            <Title order={6} fw={700}>{liability.title}</Title>
            <Text size="sm" c="dimmed" lh={1.55}>{liability.wording}</Text>
            <Checkbox
              label="I accept this liability"
              checked={ticks[liability.id] === true || isLocked}
              disabled={disabled || isLocked}
              onChange={(e) => {
                if (isLocked) return;
                onChange({ ...ticks, [liability.id]: e.currentTarget.checked });
              }}
            />
          </Stack>
        );
      })}
    </Stack>
  );
}

/** True only when every listed liability is independently ticked. */
export function allSignoffTicksSet(
  liabilities: EmailSignoffLiability[],
  ticks: EmailSignoffTicks,
): boolean {
  return liabilities.every((l) => ticks[l.id] === true);
}
