import { useState, useEffect } from 'react';
import { Tabs, Stack, Title, Text, Group, Button, Paper, Alert } from '@mantine/core';
import {
  IconUsers, IconId, IconNews, IconRefresh, IconBuildingStore,
  IconPhoto, IconCalendarEvent, IconInfoCircle,
} from '@tabler/icons-react';
import type { AppData } from '../types';
import { loadFeeds, loadAllFeedTeams, loadClubSlugs } from '../data';
import type { FeedTeamEntry } from '../data';
import { ClubForm } from '../components/customize/ClubForm';
import { TeamsForm } from '../components/customize/TeamsForm';
import { CommitteeForm } from '../components/customize/CommitteeForm';
import { NewsForm } from '../components/customize/NewsForm';
import { RegistrationForm } from '../components/customize/RegistrationForm';
import { GalleryForm } from '../components/customize/GalleryForm';
import { MatchdayForm } from '../components/customize/MatchdayForm';
import { SaveButton } from '../components/customize/SaveButton';
import { useClub } from '../context/ClubContext';

interface Props {
  originalData: AppData;
  editingData: AppData | null;
  onEditingChange: (data: AppData) => void;
  onApplyPreview: (data: AppData) => void;
  onResetPreview: () => void;
  previewActive: boolean;
  onPrimaryColorSaved?: (color: string | null) => void;
}

export function CustomizePage({
  originalData,
  editingData,
  onEditingChange,
  onApplyPreview,
  onResetPreview,
  previewActive,
  onPrimaryColorSaved,
}: Props) {
  const { clubSlug } = useClub();
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [feedTeams, setFeedTeams] = useState<FeedTeamEntry[]>([]);
  const [clubSlugs, setClubSlugs] = useState<string[]>([]);

  useEffect(() => {
    if (!editingData) {
      onEditingChange(JSON.parse(JSON.stringify(originalData)));
    }
    loadAllFeedTeams().then(setFeedTeams);
    loadClubSlugs().then(setClubSlugs);
  }, []);

  if (!editingData) return null;

  const localData = editingData;
  const set = (updater: AppData | ((prev: AppData) => AppData)) => {
    const next = typeof updater === 'function' ? updater(editingData) : updater;
    onEditingChange(next);
  };

  const applyPreview = async () => {
    const slugsChanged =
      localData.club.clubFeedSlug !== originalData.club.clubFeedSlug ||
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
          Edit your club's content below. Preview changes live, then save to publish.
        </Text>
      </div>

      <Paper p="md" withBorder>
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <SaveButton
              data={localData}
              onSaved={(savedClub) => {
                if (savedClub?.primaryColor !== undefined) {
                  onPrimaryColorSaved?.(savedClub.primaryColor ?? null);
                }
              }}
            />
            <Button variant="light" onClick={applyPreview} loading={loadingFeeds}>
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

      <Tabs defaultValue="club">
        <Tabs.List>
          <Tabs.Tab value="club" leftSection={<IconInfoCircle size={14} />}>Club Info</Tabs.Tab>
          <Tabs.Tab value="teams" leftSection={<IconUsers size={14} />}>Teams</Tabs.Tab>
          <Tabs.Tab value="committee" leftSection={<IconId size={14} />}>Committee</Tabs.Tab>
          <Tabs.Tab value="news" leftSection={<IconNews size={14} />}>News</Tabs.Tab>
          <Tabs.Tab value="registration" leftSection={<IconBuildingStore size={14} />}>Registration</Tabs.Tab>
          <Tabs.Tab value="gallery" leftSection={<IconPhoto size={14} />}>Gallery</Tabs.Tab>
          <Tabs.Tab value="matchday" leftSection={<IconCalendarEvent size={14} />}>Matchday</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="club" pt="md">
          <ClubForm
            club={localData.club}
            onChange={club => {
              set(d => ({ ...d, club }));
            }}
            clubSlugs={clubSlugs}
          />
        </Tabs.Panel>

        <Tabs.Panel value="teams" pt="md">
          <TeamsForm
            teams={localData.teams}
            onChange={teams => set(d => ({ ...d, teams }))}
            feedTeams={feedTeams}
            teamSlugPrefix={localData.club.teamSlugPrefix || (localData.club.clubFeedSlug ? `${localData.club.clubFeedSlug}-` : undefined)}
          />
        </Tabs.Panel>

        <Tabs.Panel value="committee" pt="md">
          <CommitteeForm
            committee={localData.committee}
            onChange={committee => set(d => ({ ...d, committee }))}
          />
        </Tabs.Panel>

        <Tabs.Panel value="news" pt="md">
          <NewsForm
            news={localData.news}
            onChange={news => set(d => ({ ...d, news }))}
          />
        </Tabs.Panel>

        <Tabs.Panel value="registration" pt="md">
          <RegistrationForm
            registration={localData.registration}
            onChange={registration => set(d => ({ ...d, registration }))}
          />
        </Tabs.Panel>

        <Tabs.Panel value="gallery" pt="md">
          <GalleryForm
            gallery={localData.gallery}
            onChange={gallery => set(d => ({ ...d, gallery }))}
          />
        </Tabs.Panel>

        <Tabs.Panel value="matchday" pt="md">
          <MatchdayForm
            matchday={localData.matchday}
            onChange={matchday => set(d => ({ ...d, matchday }))}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
