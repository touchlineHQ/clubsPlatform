import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadClubSlugs,
  loadAllFeedTeams,
  teamFeedUrl,
  teamCalendarUrl,
  loadTeamFeed,
  loadClubRegistry,
  loadAllData,
} from '../data';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

// ─── loadClubSlugs ────────────────────────────────────────────────────────────

describe('loadClubSlugs', () => {
  it('returns sorted slugs stripped of .json extension on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'east-leake.json' }, { name: 'riverside.json' }],
    });

    const result = await loadClubSlugs();
    expect(result).toEqual(['east-leake', 'riverside']);
  });

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await loadClubSlugs();
    expect(result).toEqual([]);
  });

  it('returns empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await loadClubSlugs();
    expect(result).toEqual([]);
  });
});

// ─── loadAllFeedTeams ─────────────────────────────────────────────────────────

describe('loadAllFeedTeams', () => {
  it('returns empty array when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await loadAllFeedTeams();
    expect(result).toEqual([]);
  });

  it('returns empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await loadAllFeedTeams();
    expect(result).toEqual([]);
  });

  it('returns flat FeedTeamEntry list with league attached', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        leagues: [
          {
            slug: 'sunday-league',
            teams: [{ name: 'First XI', slug: 'first-xi' }],
          },
        ],
      }),
    });

    const result = await loadAllFeedTeams();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'First XI', slug: 'first-xi', league: 'sunday-league' });
  });
});

// ─── teamFeedUrl ──────────────────────────────────────────────────────────────

describe('teamFeedUrl', () => {
  it('returns a URL string containing the league and slug', () => {
    const url = teamFeedUrl('sunday-league', 'first-xi');
    expect(url).toContain('sunday-league');
    expect(url).toContain('first-xi');
  });
});

// ─── teamCalendarUrl ──────────────────────────────────────────────────────────

describe('teamCalendarUrl', () => {
  it('returns a URL string containing the league and slug and ending in .ics', () => {
    const url = teamCalendarUrl('sunday-league', 'first-xi');
    expect(url).toContain('sunday-league');
    expect(url).toContain('first-xi');
    expect(url.endsWith('.ics')).toBe(true);
  });
});

// ─── loadTeamFeed ─────────────────────────────────────────────────────────────

describe('loadTeamFeed', () => {
  it('returns parsed team feed on success', async () => {
    const teamFeed = {
      team: 'First XI',
      league: 'sunday-league',
      generated: '2026-05-12T00:00:00Z',
      fixtures: [],
      results: [],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => teamFeed,
    });

    const result = await loadTeamFeed('sunday-league', 'first-xi');
    expect(result).toEqual(teamFeed);
  });

  it('returns null when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await loadTeamFeed('sunday-league', 'first-xi');
    expect(result).toBeNull();
  });
});

// ─── loadClubRegistry ────────────────────────────────────────────────────────

describe('loadClubRegistry', () => {
  it('returns registry from /api/clubs when that endpoint succeeds', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        multiClub: true,
        pitchBookings: false,
        clubs: [{ id: 'c1', slug: 'east-leake', name: 'East Leake FC', location: 'East Leake' }],
      }),
    });

    const result = await loadClubRegistry();
    expect(result.multiClub).toBe(true);
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].slug).toBe('east-leake');
  });

  it('falls back to static /data/clubs/index.json when API fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/clubs') {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          clubs: [{ id: 'c1', slug: 'east-leake', name: 'East Leake FC', location: 'East Leake' }],
        }),
      });
    });

    const result = await loadClubRegistry();
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].slug).toBe('east-leake');
  });

  it('returns empty registry when both API and static fetch throw', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await loadClubRegistry();
    expect(result).toEqual({ multiClub: false, pitchBookings: false, clubs: [] });
  });

  it('returns empty registry when static fetch also fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/clubs') return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false });
    });

    const result = await loadClubRegistry();
    expect(result).toEqual({ multiClub: false, pitchBookings: false, clubs: [] });
  });

  it('uses ?? defaults when API response is missing multiClub/pitchBookings/clubs fields', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await loadClubRegistry();
    expect(result).toEqual({ multiClub: false, pitchBookings: false, clubs: [] });
  });

  it('uses ?? default for clubs when static fallback response has no clubs field', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/clubs') return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const result = await loadClubRegistry();
    expect(result).toEqual({ multiClub: false, pitchBookings: false, clubs: [] });
  });
});

// ─── loadAllData ──────────────────────────────────────────────────────────────

const minimalClub = {
  slug: 'test-club', name: 'Test FC', tagline: '', founded: 2000,
  email: 'info@test.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: '', socials: {}, about: ['About text'], history: [],
};

function makeSingleClubFetch() {
  return (url: string) => {
    const u = url.toString();
    if (u.includes('/data/clubs/test-club/club.json')) {
      return Promise.resolve({ ok: true, json: async () => minimalClub });
    }
    if (u.includes('/api/teams')) {
      return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
    }
    if (u.includes('/api/committee')) {
      // Return non-empty so loadCommitteeFromApi returns non-null (no static fallback needed)
      return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 'm1', role: 'Chair', name: 'Alice', contact: '' }] }) });
    }
    if (u.includes('/api/news')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 'n1', title: 'News', body: '', link: '#', linkText: 'Read', createdAt: 0 }] }) });
    }
    if (u.includes('/data/clubs/test-club/registration.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    if (u.includes('/data/clubs/test-club/gallery.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    if (u.includes('/data/clubs/test-club/matchday.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    // Teams/committee fallback static files
    if (u.includes('/data/clubs/test-club/teams.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ sections: [] }) });
    }
    if (u.includes('/data/clubs/test-club/committee.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ committee: [] }) });
    }
    if (u.includes('/data/clubs/test-club/news.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    // Feed URLs → fail gracefully (loadClubFeed/loadFeedTeams return null/[])
    return Promise.resolve({ ok: false });
  };
}

describe('loadAllData (single-club)', () => {
  it('returns AppData with club from static file', async () => {
    mockFetch.mockImplementation(makeSingleClubFetch());
    const data = await loadAllData('test-club', false);
    expect(data.club.slug).toBe('test-club');
    expect(data.club.name).toBe('Test FC');
  });

  it('includes news visibility based on news items returned from API', async () => {
    mockFetch.mockImplementation(makeSingleClubFetch());
    const data = await loadAllData('test-club', false);
    expect(data.visibility['/news']).toBe(true);
  });

  it('sets /about visibility to true when about array is non-empty', async () => {
    mockFetch.mockImplementation(makeSingleClubFetch());
    const data = await loadAllData('test-club', false);
    expect(data.visibility['/about']).toBe(true);
  });

  it('falls back to committee.json when /api/committee returns ok:false (single-club)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/committee')) return Promise.resolve({ ok: false });
      return makeSingleClubFetch()(url);
    });
    const data = await loadAllData('test-club', false);
    expect(data.committee).toBeDefined();
  });

  it('falls back to news.json when /api/news returns ok:false (single-club)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/news')) return Promise.resolve({ ok: false });
      return makeSingleClubFetch()(url);
    });
    const data = await loadAllData('test-club', false);
    expect(data.news).toBeDefined();
  });

  it('sets /committee visibility to true when committee has members', async () => {
    mockFetch.mockImplementation(makeSingleClubFetch());
    const data = await loadAllData('test-club', false);
    expect(data.visibility['/committee']).toBe(true);
  });

  it('sets /about visibility to false when club has no about or history', async () => {
    const clubWithoutAbout = { ...minimalClub, about: [], history: [] };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/data/clubs/test-club/club.json'))
        return Promise.resolve({ ok: true, json: async () => clubWithoutAbout });
      return makeSingleClubFetch()(url);
    });
    const data = await loadAllData('test-club', false);
    expect(data.visibility['/about']).toBe(false);
  });

  it('sets /about visibility to true when club has history but no about', async () => {
    const clubWithHistory = { ...minimalClub, about: [], history: ['Founded 1920'] };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/data/clubs/test-club/club.json'))
        return Promise.resolve({ ok: true, json: async () => clubWithHistory });
      return makeSingleClubFetch()(url);
    });
    const data = await loadAllData('test-club', false);
    expect(data.visibility['/about']).toBe(true);
  });

  it('uses API teams when /api/teams returns valid sections', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/teams')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sections: [{ id: 's1', sectionKey: 'seniors', name: 'Seniors', subtitle: '', icon: 'users', logo: null, sortOrder: 1 }],
            teams: [],
          }),
        });
      }
      return makeSingleClubFetch()(url);
    });
    const data = await loadAllData('test-club', false);
    expect(data.teams.sections).toHaveLength(1);
    expect(data.teams.sections[0].id).toBe('seniors');
  });
});

describe('loadAllData error paths (multi-club)', () => {
  it('registration/gallery/matchday return empty arrays when APIs return ok:false', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) return Promise.resolve({ ok: true, json: async () => minimalClub });
      if (url.includes('/api/teams')) return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
      if (url.includes('/api/committee')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/news')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/registration')) return Promise.resolve({ ok: false });
      if (url.includes('/api/gallery')) return Promise.resolve({ ok: false });
      if (url.includes('/api/matchday')) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.registration).toEqual([]);
    expect(data.gallery).toEqual([]);
    expect(data.matchday).toEqual([]);
  });

  it('items fields absent in API responses use ?? [] fallback', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) return Promise.resolve({ ok: true, json: async () => minimalClub });
      if (url.includes('/api/teams')) return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
      if (url.includes('/api/committee')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/news')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/registration')) return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url.includes('/api/gallery')) return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url.includes('/api/matchday')) return Promise.resolve({ ok: true, json: async () => ({}) });
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.registration).toEqual([]);
    expect(data.gallery).toEqual([]);
    expect(data.matchday).toEqual([]);
  });

  it('teams falls back to empty sections when API returns null sections', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) return Promise.resolve({ ok: true, json: async () => minimalClub });
      if (url.includes('/api/teams')) return Promise.resolve({ ok: false });
      if (url.includes('/api/committee')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/news')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/registration')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/gallery')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/matchday')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.teams.sections).toEqual([]);
  });

  it('news falls back to empty array when API returns null', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) return Promise.resolve({ ok: true, json: async () => minimalClub });
      if (url.includes('/api/teams')) return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
      if (url.includes('/api/committee')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/news')) return Promise.resolve({ ok: false });
      if (url.includes('/api/registration')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/gallery')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/matchday')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.news).toEqual([]);
  });

  it('committee falls back to empty when API returns null', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) return Promise.resolve({ ok: true, json: async () => minimalClub });
      if (url.includes('/api/teams')) return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
      if (url.includes('/api/committee')) return Promise.resolve({ ok: false });
      if (url.includes('/api/news')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/registration')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/gallery')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      if (url.includes('/api/matchday')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.committee.committee).toEqual([]);
  });
});

describe('loadAllData (multi-club)', () => {
  it('loads club from API in multi-club mode', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/club')) {
        return Promise.resolve({ ok: true, json: async () => minimalClub });
      }
      if (url.includes('/api/teams')) {
        return Promise.resolve({ ok: true, json: async () => ({ sections: [], teams: [] }) });
      }
      if (url.includes('/api/committee')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (url.includes('/api/news')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (url.includes('/api/registration')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (url.includes('/api/gallery')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (url.includes('/api/matchday')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      return Promise.resolve({ ok: false });
    });
    const data = await loadAllData('test-club', true);
    expect(data.club.slug).toBe('test-club');
  });
});
