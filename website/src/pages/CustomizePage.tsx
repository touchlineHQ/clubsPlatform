import { useState, useEffect } from 'react';
import { Tabs, Stack, Title, Text, Group, Button, Paper, Select, Alert } from '@mantine/core';
import {
  IconUsers, IconId, IconNews, IconRefresh, IconPalette,
} from '@tabler/icons-react';
import type { AppData } from '../types';
import { loadFeeds, loadClubSlugs, loadAllFeedTeams } from '../data';
import type { FeedTeamEntry } from '../data';
import { TeamsForm } from '../components/customize/TeamsForm';
import { CommitteeForm } from '../components/customize/CommitteeForm';
import { NewsForm } from '../components/customize/NewsForm';
import { SaveButton } from '../components/customize/SaveButton';
import { COLOR_OPTIONS } from '../components/customize/iconOptions';
import { useClub } from '../context/ClubContext';

interface Props {
  originalData: AppData;
  editingData: AppData | null;
  onEditingChange: (data: AppData) => void;
  onApplyPreview: (data: AppData) => void;
  onResetPreview: () => void;
  previewActive: boolean;
}

interface AppearanceTabProps {
  clubId: string;
  currentColor: string | null;
  onColorSaved: (color: string | null) => void;
}

function AppearanceTab({ clubId, currentColor, onColorSaved }: AppearanceTabProps) {
  const [color, setColor] = useState<string | null>(currentColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/clubs?id=${encodeURIComponent(clubId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryColor: color }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Request failed: ${res.status}`);
      } else {
        setSaved(true);
        onColorSaved(color);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const colorData = COLOR_OPTIONS.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

  return (
    <Stack gap="md" maw={400}>
      <div>
        <Text fw={600} mb={4}>Theme colour</Text>
        <Text size="sm" c="dimmed" mb="sm">
          Choose the primary colour for your club's site. Changes take effect immediately after saving.
        </Text>
        <Select
          data={colorData}
          value={color}
          onChange={setColor}
          placeholder="Default (blue)"
          clearable
        />
      </div>
      {error && <Alert color="red">{error}</Alert>}
      {saved && <Alert color="green">Colour saved successfully.</Alert>}
      <Group>
        <Button onClick={handleSave} loading={saving}>Save colour</Button>
      </Group>
    </Stack>
  );
}

export function CustomizePage({
  originalData,
  editingData,
  onEditingChange,
  onApplyPreview,
  onResetPreview,
  previewActive,
}: Props) {
  const { clubs, clubSlug } = useClub();
  const clubEntry = clubs.find(c => c.slug === clubSlug);

  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [feedTeams, setFeedTeams] = useState<FeedTeamEntry[]>([]);

  useEffect(() => {
    if (!editingData) {
      onEditingChange(JSON.parse(JSON.stringify(originalData)));
    }
    loadAllFeedTeams().then(setFeedTeams);
  }, []);

  if (!editingData) return null;

  const localData = editingData;
  const setLocalData = (updater: AppData | ((prev: AppData) => AppData)) => {
    const next = typeof updater === 'function' ? updater(editingData) : updater;
    onEditingChange(next);
  };

  const applyPreview = async () => {
    const slugsChanged =
      localData.club.clubFeedSlug !== originalData.club.clubFeedSlug ||
      localData.club.teamSlugPrefix !== originalData.club.teamSlugPrefix ||
      JSON.stringify(localData.teams.sections.map(s => s.teams.map(t => t.slug))) !==
      JSON.stringify(originalData.teams.sections.map(s => s.teams.map(t => t.slug)));

    if (slugsChanged) {
      setLoadingFeeds(true);
      try {
        const feeds = await loadFeeds(localData.club, localData.teams);
        const merged = { ...localData, ...feeds };
        onEditingChange(merged);
        onApplyPreview(merged);
      } finally {
        setLoadingFeeds(false);
      }
    } else {
      onApplyPreview(localData);
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2} mb="xs">Site Admin</Title>
        <Text c="dimmed" size="sm">
          Edit your club's teams, committee, and news below. Preview changes live, then save to publish.
        </Text>
      </div>

      <Paper p="md" withBorder>
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <SaveButton data={localData} />
            <Button
              variant="light"
              onClick={applyPreview}
              loading={loadingFeeds}
            >
              Apply Preview
            </Button>
            {previewActive && (
              <Button variant="subtle" color="red" leftSection={<IconRefresh size={14} />} onClick={onResetPreview}>
                Reset
              </Button>
            )}
          </Group>
          {previewActive && (
            <Text size="xs" c="green" fw={600}>Preview active — navigate to other pages to see your changes</Text>
          )}
        </Group>
      </Paper>

      <Tabs defaultValue="teams">
        <Tabs.List>
          <Tabs.Tab value="teams" leftSection={<IconUsers size={14} />}>Teams</Tabs.Tab>
          <Tabs.Tab value="committee" leftSection={<IconId size={14} />}>Committee</Tabs.Tab>
          <Tabs.Tab value="news" leftSection={<IconNews size={14} />}>News</Tabs.Tab>
          <Tabs.Tab value="appearance" leftSection={<IconPalette size={14} />}>Appearance</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="teams" pt="md">
          <TeamsForm teams={localData.teams} onChange={teams => setLocalData(d => ({ ...d, teams }))} feedTeams={feedTeams} teamSlugPrefix={localData.club.teamSlugPrefix} />
        </Tabs.Panel>

        <Tabs.Panel value="committee" pt="md">
          <CommitteeForm committee={localData.committee} onChange={committee => setLocalData(d => ({ ...d, committee }))} />
        </Tabs.Panel>

        <Tabs.Panel value="news" pt="md">
          <NewsForm news={localData.news} onChange={news => setLocalData(d => ({ ...d, news }))} />
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="md">
          {clubEntry ? (
            <AppearanceTab
              clubId={clubEntry.id}
              currentColor={localData.club.primaryColor ?? null}
              onColorSaved={(color) => {
                const updated = { ...localData, club: { ...localData.club, primaryColor: color ?? undefined } };
                onEditingChange(updated);
                onApplyPreview(updated);
              }}
            />
          ) : (
            <Alert color="yellow">Club registry entry not found — cannot update appearance.</Alert>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
