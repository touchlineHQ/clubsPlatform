import type { AppData, Club, ClubEntry, ClubFeed, CommitteeData, GalleryItem, LiveTeam, MatchdayItem, NewsItem, RegistrationItem, TeamFeed, TeamsData } from './types';

const CLUBS_BASE = '/data/clubs/';
const FEEDS_BASE = 'https://raw.githubusercontent.com/touchlineHQ/fulltimeFeeds/main/feeds/';
const CALENDARS_BASE = 'https://raw.githubusercontent.com/touchlineHQ/fulltimeFeeds/main/calendars/';
const INDEX_URL = `${FEEDS_BASE}index.json`;
const CLUBS_API_URL = 'https://api.github.com/repos/touchlineHQ/fulltimeFeeds/contents/feeds/clubs';

export interface FeedTeamEntry {
  name: string;
  slug: string;
  league: string;
}

/** Fetch the list of available club feed slugs from the clubs directory. */
export async function loadClubSlugs(): Promise<string[]> {
  try {
    const res = await fetch(CLUBS_API_URL);
    if (!res.ok) return [];
    const files = await res.json() as { name: string }[];
    return files
      .filter(f => f.name.endsWith('.json'))
      .map(f => f.name.replace('.json', ''))
      .sort();
  } catch {
    return [];
  }
}

async function loadFeedTeams(slugPrefix?: string): Promise<FeedTeamEntry[]> {
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) return [];
    const data = await res.json() as { leagues: { slug: string; teams: { name: string; slug: string }[] }[] };
    const teams: FeedTeamEntry[] = [];
    for (const league of data.leagues) {
      for (const team of league.teams) {
        if (!slugPrefix || team.slug.startsWith(slugPrefix)) {
          teams.push({ name: team.name, slug: team.slug, league: league.slug });
        }
      }
    }
    return teams;
  } catch {
    return [];
  }
}

/** Fetch the full feed index — every team across all leagues. */
export async function loadAllFeedTeams(): Promise<FeedTeamEntry[]> {
  return loadFeedTeams();
}

export function teamFeedUrl(league: string, slug: string): string {
  return `${FEEDS_BASE}${league}/teams/${slug}.json`;
}

export function teamCalendarUrl(league: string, slug: string): string {
  return `${CALENDARS_BASE}${league}/${slug}.ics`;
}

export async function loadTeamFeed(league: string, slug: string): Promise<TeamFeed | null> {
  try {
    const res = await fetch(teamFeedUrl(league, slug));
    if (!res.ok) return null;
    return res.json() as Promise<TeamFeed>;
  } catch {
    return null;
  }
}

/** Load a static JSON file for the given club slug. */
async function load<T>(clubSlug: string, file: string): Promise<T> {
  const res = await fetch(`${CLUBS_BASE}${clubSlug}/${file}`);
  if (!res.ok) throw new Error(`Failed to load ${clubSlug}/${file}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadClubFeed(feedSlug: string): Promise<ClubFeed | null> {
  try {
    const res = await fetch(`${FEEDS_BASE}clubs/${feedSlug}.json`);
    if (!res.ok) return null;
    return res.json() as Promise<ClubFeed>;
  } catch {
    return null;
  }
}

/** Fetch live feeds (club feed, live teams, sidebar feeds) for a given club + teams config. */
export async function loadFeeds(
  club: Club,
  teams: TeamsData,
): Promise<Pick<AppData, 'clubFeed' | 'liveTeams' | 'sidebarFeeds'>> {
  const feedSlug = club.clubFeedSlug ?? '';
  const teamSlugPrefix = club.teamSlugPrefix ?? `${feedSlug}-`;

  const [clubFeed, liveTeams] = await Promise.all([
    loadClubFeed(feedSlug),
    loadFeedTeams(teamSlugPrefix),
  ]);

  const sidebarConfigs = teams.sections
    .flatMap(s => s.teams.filter(t => t.sidebar && t.slug).map(t => ({ slug: t.slug!, label: t.name, sectionId: s.id })));

  const resolvedFeeds = await Promise.all(
    sidebarConfigs.map(async ({ slug, label, sectionId }) => {
      const team = (liveTeams as LiveTeam[]).find(t => t.slug === slug);
      if (!team) return null;
      const feed = await loadTeamFeed(team.league, team.slug);
      return feed ? { feed, label, sectionId } : null;
    })
  );
  const sidebarFeeds = resolvedFeeds.filter((f): f is { feed: TeamFeed; label: string; sectionId: string } => f !== null);

  return { clubFeed, liveTeams, sidebarFeeds };
}

/** Build headers with club slug for API requests. */
function clubHeaders(clubSlug: string): HeadersInit {
  return { 'X-Club-Slug': clubSlug };
}

async function loadNewsFromApi(clubSlug: string): Promise<NewsItem[] | null> {
  try {
    const res = await fetch('/api/news', { headers: clubHeaders(clubSlug) });
    if (!res.ok) return null;
    const data = await res.json() as { items: NewsItem[] };
    return data.items?.length ? data.items : null;
  } catch {
    return null;
  }
}

async function loadCommitteeFromApi(clubSlug: string): Promise<CommitteeData | null> {
  try {
    const res = await fetch('/api/committee', { headers: clubHeaders(clubSlug) });
    if (!res.ok) return null;
    const data = await res.json() as { items: CommitteeData['committee'] };
    return data.items?.length ? { committee: data.items } : null;
  } catch {
    return null;
  }
}

async function loadTeamsFromApi(clubSlug: string): Promise<TeamsData | null> {
  try {
    const res = await fetch('/api/teams', { headers: clubHeaders(clubSlug) });
    if (!res.ok) return null;
    const { sections: rawSections, teams: rawTeams } = await res.json() as {
      sections: Array<{ id: string; sectionKey: string; name: string; subtitle: string; icon: string; logo: string | null; sortOrder: number }>;
      teams: Array<{ id: string; sectionId: string; name: string; description: string; manager: string; coach: string; contact: string; photo: string | null; slug: string | null; sidebar: number; managerLabel: string | null; coachLabel: string | null; sortOrder: number }>;
    };
    if (!rawSections?.length) return null;
    return {
      sections: rawSections
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(s => ({
          id: s.sectionKey,
          name: s.name,
          subtitle: s.subtitle,
          icon: s.icon,
          logo: s.logo ?? undefined,
          teams: rawTeams
            .filter(t => t.sectionId === s.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(t => ({
              name: t.name,
              description: t.description,
              manager: t.manager,
              coach: t.coach,
              contact: t.contact,
              photo: t.photo ?? undefined,
              slug: t.slug ?? undefined,
              sidebar: t.sidebar === 1,
              managerLabel: t.managerLabel ?? undefined,
              coachLabel: t.coachLabel ?? undefined,
            })),
        })),
    };
  } catch {
    return null;
  }
}

/**
 * Load the club registry: list of clubs and whether multi-club mode is active.
 * Tries GET /api/clubs first; falls back to static /data/clubs/index.json.
 */
export async function loadClubRegistry(): Promise<{ multiClub: boolean; clubs: ClubEntry[] }> {
  try {
    const res = await fetch('/api/clubs');
    if (res.ok) {
      const data = await res.json() as { multiClub: boolean; clubs: ClubEntry[] };
      // Always trust the API response — even empty clubs is valid in multi-club mode
      return { multiClub: data.multiClub ?? false, clubs: data.clubs ?? [] };
    }
  } catch {
    // fall through to static fallback
  }

  try {
    const res = await fetch('/data/clubs/index.json');
    if (res.ok) {
      const data = await res.json() as { clubs: ClubEntry[] };
      return { multiClub: false, clubs: data.clubs ?? [] };
    }
  } catch {
    // fall through
  }

  return { multiClub: false, clubs: [] };
}

export async function loadAllData(clubSlug: string): Promise<AppData> {
  // Load club config first so we can derive external feed URLs from it
  const club = await load<Club>(clubSlug, 'club.json');

  const [teamsFromApi, committeeFromApi, newsFromApi, registration, gallery, matchday] =
    await Promise.all([
      loadTeamsFromApi(clubSlug),
      loadCommitteeFromApi(clubSlug),
      loadNewsFromApi(clubSlug),
      load<{ items: RegistrationItem[] }>(clubSlug, 'registration.json').then(d => d.items),
      load<{ items: GalleryItem[] }>(clubSlug, 'gallery.json').then(d => d.items),
      load<{ items: MatchdayItem[] }>(clubSlug, 'matchday.json').then(d => d.items),
    ]);

  // Fall back to static JSON if the DB is empty or unavailable
  const teams = teamsFromApi ?? await load<TeamsData>(clubSlug, 'teams.json');
  const committee = committeeFromApi ?? await load<CommitteeData>(clubSlug, 'committee.json');
  const news = newsFromApi ?? await load<{ items: NewsItem[] }>(clubSlug, 'news.json').then(d => d.items);

  const feeds = await loadFeeds(club, teams);

  return { club, teams, committee, registration, news, gallery, matchday, ...feeds } as AppData;
}
