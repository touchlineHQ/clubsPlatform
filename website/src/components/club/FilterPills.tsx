import { Group, UnstyledButton } from '@mantine/core';
import { clubDesign } from '../../theme';

export interface PillOption<T extends string = string> {
  value: T;
  label: string;
}

interface FilterPillsProps<T extends string = string> {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Pill-style segmented filter used across redesigned club pages. Active pill
 * is filled with the primary colour, inactive pills are outlined neutrals.
 */
export function FilterPills<T extends string = string>({
  options,
  value,
  onChange,
}: FilterPillsProps<T>) {
  return (
    <Group gap={6} wrap="wrap">
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <UnstyledButton
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '4px 14px',
              borderRadius: clubDesign.radius.pill,
              fontSize: '0.78rem',
              fontWeight: 600,
              border: '1.5px solid',
              borderColor: active
                ? 'var(--mantine-primary-color-filled)'
                : clubDesign.color.n3,
              background: active ? 'var(--mantine-primary-color-filled)' : 'transparent',
              color: active ? '#fff' : clubDesign.color.n6,
              transition: 'all 0.12s',
            }}
          >
            {opt.label}
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
