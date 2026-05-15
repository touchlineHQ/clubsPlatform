import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, getReq } from '../test-utils';

// Mock auth BEFORE importing any handler
const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
}));

// ─── news ────────────────────────────────────────────────────────────────────

import { onRequestGet as newsGet } from '../../api/news';

describe('GET /api/news', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items from news_item table', async () => {
    const row = {
      id: 'news_1',
      clubSlug: null,
      title: 'Hello',
      text: 'World',
      body: null,
      link: '#',
      linkText: 'Read More',
      sections: null,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const ctx = makeContext(getReq('/api/news'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await newsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Hello');
    expect(body.items[0].text).toBe('World');
    expect(body.items[0].link).toBe('#');
    expect(body.items[0].linkText).toBe('Read More');
    expect(body.items[0].createdAt).toBe(1000);
    expect(body.items[0].updatedAt).toBe(2000);
  });
});

// ─── gallery ─────────────────────────────────────────────────────────────────

import { onRequestGet as galleryGet } from '../../api/gallery';

describe('GET /api/gallery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items from gallery_item table', async () => {
    const row = { id: 'gal_1', src: 'http://x.com/img.jpg', caption: 'Test' };
    const ctx = makeContext(getReq('/api/gallery'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await galleryGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('gal_1');
    expect(body.items[0].src).toBe('http://x.com/img.jpg');
    expect(body.items[0].caption).toBe('Test');
  });
});

// ─── matchday ────────────────────────────────────────────────────────────────

import { onRequestGet as matchdayGet } from '../../api/matchday';

describe('GET /api/matchday', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items from matchday_item table', async () => {
    const row = { id: 'md_1', icon: 'fa-futbol', title: 'Kick Off', text: '3pm' };
    const ctx = makeContext(getReq('/api/matchday'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await matchdayGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('md_1');
    expect(body.items[0].title).toBe('Kick Off');
    expect(body.items[0].text).toBe('3pm');
  });
});

// ─── registration ─────────────────────────────────────────────────────────────

import { onRequestGet as registrationGet } from '../../api/registration';

describe('GET /api/registration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items from registration_item table', async () => {
    const row = {
      id: 'reg_1',
      icon: 'fa-child',
      title: 'Juniors',
      description: 'Ages 5-12',
      link: 'https://example.com',
      buttonText: 'Sign Up',
    };
    const ctx = makeContext(getReq('/api/registration'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await registrationGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('reg_1');
    expect(body.items[0].title).toBe('Juniors');
    expect(body.items[0].buttonText).toBe('Sign Up');
  });
});

// ─── committee ───────────────────────────────────────────────────────────────

import { onRequestGet as committeeGet } from '../../api/committee';

describe('GET /api/committee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items from committee_member table', async () => {
    const row = {
      id: 'cmte_1',
      clubSlug: null,
      role: 'Chairman',
      name: 'Alice Smith',
      contact: 'alice@example.com',
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const ctx = makeContext(getReq('/api/committee'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await committeeGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('cmte_1');
    expect(body.items[0].role).toBe('Chairman');
    expect(body.items[0].name).toBe('Alice Smith');
  });
});

// ─── teams ───────────────────────────────────────────────────────────────────

import { onRequestGet as teamsGet } from '../../api/teams';

describe('GET /api/teams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sections and teams with two sequential .all() calls', async () => {
    const sectionRow = {
      id: 'sec_1',
      clubSlug: null,
      sectionKey: 'seniors',
      name: 'Seniors',
      subtitle: 'Adult Teams',
      icon: 'fa-shield-alt',
      logo: null,
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const teamRow = {
      id: 'team_1',
      sectionId: 'sec_1',
      name: 'First XI',
      description: 'Our best',
      manager: 'Bob',
      coach: 'Carol',
      contact: 'bob@example.com',
      photo: null,
      slug: 'first-xi',
      sidebar: 0,
      managerLabel: null,
      coachLabel: null,
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000,
    };

    // makeDb accepts all as array-of-arrays to return sequentially
    const ctx = makeContext(getReq('/api/teams'), {
      env: { DB: makeDb({ all: [[sectionRow], [teamRow]] }) as any },
    });

    const res = await teamsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].id).toBe('sec_1');
    expect(body.sections[0].name).toBe('Seniors');
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe('team_1');
    expect(body.teams[0].name).toBe('First XI');
  });

  it('returns empty arrays when there are no sections', async () => {
    const ctx = makeContext(getReq('/api/teams'), {
      env: { DB: makeDb({ all: [[]] }) as any },
    });

    const res = await teamsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.sections).toEqual([]);
    expect(body.teams).toEqual([]);
  });
});

// ─── pitches ─────────────────────────────────────────────────────────────────

import { onRequestGet as pitchesGet } from '../../api/pitches';

describe('GET /api/pitches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns pitches with formats parsed from JSON string', async () => {
    const row = {
      id: 'pitch_1',
      clubSlug: null,
      name: 'Main Pitch',
      formats: JSON.stringify(['11v11', '7v7']),
      description: 'Full size',
      active: 1,
    };
    const ctx = makeContext(getReq('/api/pitches'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await pitchesGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.pitches).toHaveLength(1);
    expect(body.pitches[0].id).toBe('pitch_1');
    expect(body.pitches[0].name).toBe('Main Pitch');
    expect(body.pitches[0].formats).toEqual(['11v11', '7v7']);
    expect(body.pitches[0].active).toBe(true);
  });
});

// ─── clubs ───────────────────────────────────────────────────────────────────

import { onRequestGet as clubsGet } from '../../api/clubs';

describe('GET /api/clubs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns multiClub false and filters out demo club in single-club mode', async () => {
    const rows = [
      { id: 'club_1', slug: 'test-club', name: 'Test Club', active: 1, primaryColor: null, createdAt: 1000 },
      { id: 'club_2', slug: 'demo', name: 'Demo Club', active: 1, primaryColor: null, createdAt: 2000 },
    ];
    // No MULTI_CLUB env var → single-club mode
    const ctx = makeContext(getReq('/api/clubs'), {
      env: { DB: makeDb({ all: [rows] }) as any },
    });

    const res = await clubsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.multiClub).toBe(false);
    expect(body.pitchBookings).toBe(false);
    expect(body.clubs).toHaveLength(1);
    expect(body.clubs[0].slug).toBe('test-club');
  });

  it('returns multiClub true and includes demo club when MULTI_CLUB is set', async () => {
    const rows = [
      { id: 'club_1', slug: 'test-club', name: 'Test Club', active: 1, primaryColor: null, createdAt: 1000 },
      { id: 'club_2', slug: 'demo', name: 'Demo Club', active: 1, primaryColor: null, createdAt: 2000 },
    ];
    const ctx = makeContext(getReq('/api/clubs'), {
      env: { DB: makeDb({ all: [rows] }) as any, MULTI_CLUB: '1' } as any,
    });

    const res = await clubsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.multiClub).toBe(true);
    expect(body.clubs).toHaveLength(2);
  });
});

// ─── team-contacts ────────────────────────────────────────────────────────────

import { onRequestGet as teamContactsGet } from '../../api/team-contacts';

describe('GET /api/team-contacts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns contacts for a given slug and league', async () => {
    const row = { id: 'utr_1', role: 'manager', name: 'Dave Jones', email: 'dave@example.com' };
    const ctx = makeContext(getReq('/api/team-contacts?slug=first-xi&league=sunday-league'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await teamContactsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe('utr_1');
    expect(body.contacts[0].role).toBe('manager');
    expect(body.contacts[0].name).toBe('Dave Jones');
    expect(body.contacts[0].email).toBe('dave@example.com');
  });

  it('returns empty contacts when no slug is provided', async () => {
    const ctx = makeContext(getReq('/api/team-contacts'), {
      env: { DB: makeDb({ all: [[]] }) as any },
    });

    const res = await teamContactsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.contacts).toEqual([]);
  });

  it('returns contacts for a slug without a league filter', async () => {
    const row = { id: 'utr_2', role: 'coach', name: 'Eve Brown', email: 'eve@example.com' };
    const ctx = makeContext(getReq('/api/team-contacts?slug=first-xi'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await teamContactsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].role).toBe('coach');
  });
});
