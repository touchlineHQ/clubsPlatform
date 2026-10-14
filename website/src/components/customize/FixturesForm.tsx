import { TextInput, Select, Stack, Group, Title, Paper, Button, Text, Autocomplete } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { ManualFixture } from '../../types';

interface Props {
  fixtures: ManualFixture[];
  /** The club's own team names, offered as suggestions. */
  teamNames: string[];
  onChange: (fixtures: ManualFixture[]) => void;
}

const blank = (): ManualFixture => ({
  team: '', date: '', time: '', homeAway: 'home', opponent: '', venue: '', competition: '',
  homeScore: null, awayScore: null,
});

function toScore(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

/**
 * Manual fixtures and results (#78): friendlies, cup games, or a whole season
 * for a club whose league is not in the FA feed. Leave the scores empty for a
 * game not yet played. The FA feed wins if it covers the same team and day.
 */
export function FixturesForm({ fixtures, teamNames, onChange }: Props) {
  const update = (i: number, patch: Partial<ManualFixture>) => {
    const items = [...fixtures];
    items[i] = { ...items[i], ...patch };
    onChange(items);
  };
  const remove = (i: number) => onChange(fixtures.filter((_, idx) => idx !== i));
  const suggestions = Array.from(new Set(teamNames.filter(Boolean)));

  return (
    <Stack gap="lg">
      <Title order={4}>Fixtures &amp; Results</Title>
      <Text size="sm" c="dimmed">
        Record games the league feed does not carry. Leave the score empty until the game is played.
        If the FA feed lists the same team on the same day, the feed&apos;s version is shown instead.
      </Text>
      {fixtures.map((f, i) => (
        <Paper key={f.id ?? i} p="sm" withBorder>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              {f.team && f.opponent ? `${f.team} v ${f.opponent}` : `Game ${i + 1}`}
            </Text>
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => remove(i)} leftSection={<IconTrash size={12} />}>
              Remove
            </Button>
          </Group>
          <Stack gap="xs">
            <Group grow>
              <Autocomplete label="Our team" required data={suggestions} value={f.team} onChange={v => update(i, { team: v })} />
              <TextInput label="Opponent" required value={f.opponent} onChange={e => update(i, { opponent: e.target.value })} />
            </Group>
            <Group grow>
              <TextInput label="Date" type="date" required value={f.date} onChange={e => update(i, { date: e.target.value })} />
              <TextInput label="Kick-off" type="time" value={f.time} onChange={e => update(i, { time: e.target.value })} />
              <Select
                label="Home or away"
                data={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
                value={f.homeAway}
                onChange={v => update(i, { homeAway: v === 'away' ? 'away' : 'home' })}
                allowDeselect={false}
              />
            </Group>
            <Group grow>
              <TextInput label="Competition" placeholder="Friendly, County Cup…" value={f.competition} onChange={e => update(i, { competition: e.target.value })} />
              <TextInput label="Venue" value={f.venue} onChange={e => update(i, { venue: e.target.value })} />
            </Group>
            <Group grow>
              <TextInput label="Home score" type="number" inputMode="numeric" min={0} max={99} step={1} value={f.homeScore ?? ''} onChange={e => update(i, { homeScore: toScore(e.target.value) })} />
              <TextInput label="Away score" type="number" inputMode="numeric" min={0} max={99} step={1} value={f.awayScore ?? ''} onChange={e => update(i, { awayScore: toScore(e.target.value) })} />
            </Group>
          </Stack>
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={14} />} onClick={() => onChange([...fixtures, blank()])}>
        Add Game
      </Button>
    </Stack>
  );
}
