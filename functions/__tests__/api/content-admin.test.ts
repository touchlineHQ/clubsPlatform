import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, adminSession, postReq, patchReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

// ─── news.ts ──────────────────────────────────────────────────────────────────

import { onRequestGet as newsGet, onRequestPost as newsPost, onRequestPatch as newsPatch, onRequestDelete as newsDelete } from '../../api/news';

describe('news POST (create)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('creates a news item and returns 201', async () => {
    const req = postReq('/api/news', { title: 'Hello', text: 'World' });
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^news_/);
  });

  it('returns 400 when title is missing', async () => {
    const req = postReq('/api/news', { text: 'World' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/title/);
  });

  it('returns 400 when text is missing', async () => {
    const req = postReq('/api/news', { title: 'Hello' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/news', { title: 'Hi', text: 'There' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('creates news item with link and linkText provided', async () => {
    const req = postReq('/api/news', { title: 'Hello', text: 'World', link: '/custom', linkText: 'Read More' });
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('creates news item with sections array', async () => {
    const req = postReq('/api/news', { title: 'Hello', text: 'World', sections: ['seniors'] });
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await newsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });
});

describe('news PATCH (update)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('updates an existing news item', async () => {
    const req = patchReq('/api/news?id=news_1', { title: 'Updated Title' });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { id: 'news_1' }, run: { meta: { changes: 1 } } }) },
    });
    const res = await newsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when news item does not exist', async () => {
    const req = patchReq('/api/news?id=news_1', { title: 'Updated' });
    const ctx = makeContext(req, { env: { DB: makeDb({ first: null }) } });
    const res = await newsPatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when id query param is missing', async () => {
    const req = patchReq('/api/news', { title: 'Updated' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/);
  });

  it('patches news item with all fields', async () => {
    const req = patchReq('/api/news?id=news_1', {
      title: 'Updated Title',
      text: 'Updated text',
      body: 'Updated body',
      link: '/updated',
      linkText: 'Read',
      sections: ['seniors', 'juniors'],
    });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { id: 'news_1' }, run: { meta: { changes: 1 } } }) },
    });
    const res = await newsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('patches news item with sections set to null', async () => {
    const req = patchReq('/api/news?id=news_1', { sections: null });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { id: 'news_1' }, run: { meta: { changes: 1 } } }) },
    });
    const res = await newsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });
});

describe('news DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deletes a news item and returns ok', async () => {
    const req = deleteReq('/api/news?id=news_1');
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await newsDelete(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.changes).toBe(1);
  });

  it('returns 400 when id query param is missing', async () => {
    const req = deleteReq('/api/news');
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = deleteReq('/api/news?id=news_1');
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await newsDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('news GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns news items with sections parsed from JSON', async () => {
    const req = new Request('https://example.com/api/news', { headers: { 'X-Club-Slug': 'test-club' } });
    const ctx = makeContext(req, {
      env: {
        DB: makeDb({
          all: [[
            {
              id: 'news_1', clubSlug: 'test-club', title: 'Big Match', text: 'We won!',
              body: null, link: '/news/1', linkText: 'Read More',
              sections: '["seniors","juniors"]',
              createdAt: 1700000000, updatedAt: 1700000000,
            },
          ]],
        }),
      },
    });
    const res = await newsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0].sections).toEqual(['seniors', 'juniors']);
  });
});

// ─── gallery.ts ───────────────────────────────────────────────────────────────

import { onRequestPost as galleryPost } from '../../api/gallery';

describe('gallery POST (replace all)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('replaces all gallery items and returns ok', async () => {
    const req = postReq('/api/gallery', { items: [{ src: 'x', caption: 'y' }] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await galleryPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('replaces gallery with empty list', async () => {
    const req = postReq('/api/gallery', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await galleryPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/gallery', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await galleryPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── matchday.ts ──────────────────────────────────────────────────────────────

import { onRequestPost as matchdayPost } from '../../api/matchday';

describe('matchday POST (replace all)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('replaces all matchday items and returns ok', async () => {
    const req = postReq('/api/matchday', {
      items: [{ icon: 'fa-clock', title: 'Kick Off', text: '3pm' }],
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await matchdayPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('replaces matchday with empty list', async () => {
    const req = postReq('/api/matchday', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await matchdayPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/matchday', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await matchdayPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── registration.ts ──────────────────────────────────────────────────────────

import { onRequestPost as registrationPost } from '../../api/registration';

describe('registration POST (replace all)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('replaces all registration items and returns ok', async () => {
    const req = postReq('/api/registration', {
      items: [
        {
          icon: 'fa-child',
          title: 'Youth Teams',
          description: 'For kids aged 5-16',
          link: '/register/youth',
          buttonText: 'Sign Up',
        },
      ],
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await registrationPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('replaces registration with empty list', async () => {
    const req = postReq('/api/registration', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await registrationPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/registration', { items: [] });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await registrationPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── committee.ts ─────────────────────────────────────────────────────────────

import {
  onRequestPost as committeePost,
  onRequestPatch as committeePatch,
  onRequestDelete as committeeDelete,
} from '../../api/committee';

describe('committee POST (create)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('creates a committee member and returns 201', async () => {
    const req = postReq('/api/committee', { role: 'Chairman', name: 'John Smith', contact: 'john@club.com' });
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await committeePost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^committee_/);
  });

  it('returns 400 when role is missing', async () => {
    const req = postReq('/api/committee', { name: 'John Smith' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await committeePost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/role/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/committee', { role: 'Chairman' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await committeePost(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('committee PATCH (update)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('updates an existing committee member', async () => {
    const req = patchReq('/api/committee?id=committee_1', { name: 'Jane Doe' });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { id: 'committee_1' }, run: { meta: { changes: 1 } } }) },
    });
    const res = await committeePatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when member does not exist', async () => {
    const req = patchReq('/api/committee?id=committee_1', { name: 'Jane Doe' });
    const ctx = makeContext(req, { env: { DB: makeDb({ first: null }) } });
    const res = await committeePatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when id query param is missing', async () => {
    const req = patchReq('/api/committee', { name: 'Jane Doe' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await committeePatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/);
  });
});

describe('committee DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deletes a committee member and returns ok', async () => {
    const req = deleteReq('/api/committee?id=committee_1');
    const ctx = makeContext(req, { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) } });
    const res = await committeeDelete(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.changes).toBe(1);
  });

  it('returns 400 when id query param is missing', async () => {
    const req = deleteReq('/api/committee');
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await committeeDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = deleteReq('/api/committee?id=committee_1');
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await committeeDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── club.ts ──────────────────────────────────────────────────────────────────

import { onRequestPatch as clubPatch } from '../../api/club';

describe('club PATCH (update club data)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('updates club data and returns ok', async () => {
    const req = patchReq('/api/club', { tagline: 'Play Hard' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { data: '{}' }, run: { meta: { changes: 1 } } }) },
    });
    const res = await clubPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('merges new fields into existing data', async () => {
    const existingData = JSON.stringify({ tagline: 'Old Tagline', founded: 1990 });
    const req = patchReq('/api/club', { tagline: 'New Tagline' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ first: { data: existingData }, run: { meta: { changes: 1 } } }) },
    });
    const res = await clubPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when club does not exist', async () => {
    const req = patchReq('/api/club', { tagline: 'Play Hard' }, { 'X-Club-Slug': 'unknown-club' });
    const ctx = makeContext(req, { env: { DB: makeDb({ first: null }) } });
    const res = await clubPatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when X-Club-Slug header is missing', async () => {
    const req = patchReq('/api/club', { tagline: 'Play Hard' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await clubPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/X-Club-Slug/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = patchReq('/api/club', { tagline: 'Play Hard' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await clubPatch(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── content.ts ───────────────────────────────────────────────────────────────

import { onRequestPost as contentPost } from '../../api/content';

describe('content POST (bulk import)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('imports news.json and returns ok', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/news.json',
      content: {
        items: [
          {
            title: 'Big Match',
            text: 'We won!',
            link: '/news/1',
            linkText: 'Read More',
          },
        ],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports committee.json and returns ok', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/committee.json',
      content: {
        committee: [
          { role: 'Chairman', name: 'Alice', contact: 'alice@club.com' },
          { role: 'Secretary', name: 'Bob', contact: 'bob@club.com' },
        ],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports teams.json and returns ok', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/teams.json',
      content: {
        sections: [
          {
            id: 'seniors',
            name: 'Senior Teams',
            subtitle: 'Our adult sides',
            icon: 'fa-shield-alt',
            teams: [
              {
                name: 'First XI',
                description: 'Top team',
                manager: 'Dave',
                coach: 'Eve',
                contact: 'dave@club.com',
              },
            ],
          },
        ],
      },
    });
    // First .all() is the existing sections query (returns empty so no DELETE team stmt added)
    const ctx = makeContext(req, {
      env: { DB: makeDb({ all: [[]] }) },
    });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 400 for an invalid file path', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/unknown.json',
      content: {},
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Invalid file/);
  });

  it('returns 400 when file is missing', async () => {
    const req = postReq('/api/content', { content: {} });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/file/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/content', {
      file: 'website/public/data/news.json',
      content: { items: [] },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('imports news.json with null items uses empty fallback', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/news.json',
      content: { items: null },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports news.json with item missing optional fields (uses ?? fallbacks)', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/news.json',
      content: {
        items: [{}],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports news.json with item having non-empty sections array', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/news.json',
      content: {
        items: [{
          title: 'Big Match',
          text: 'We won!',
          link: '/news/1',
          linkText: 'Read More',
          sections: ['seniors', 'juniors'],
        }],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports committee.json with null committee uses empty fallback', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/committee.json',
      content: { committee: null },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports committee.json with members missing all fields (uses ?? fallbacks)', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/committee.json',
      content: {
        committee: [{}],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports teams.json with pre-existing sections (triggers DELETE team stmt)', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/teams.json',
      content: {
        sections: [{
          id: 'seniors',
          name: 'Senior Teams',
          subtitle: '',
          icon: 'fa-shield-alt',
          teams: [],
        }],
      },
    });
    const ctx = makeContext(req, {
      env: { DB: makeDb({ all: [[{ id: 'section_old_1' }]] }) },
    });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports teams.json with null sections uses empty fallback', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/teams.json',
      content: { sections: null },
    });
    const ctx = makeContext(req, { env: { DB: makeDb({ all: [[]] }) } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('imports teams.json section with null optional fields and team with all optional fields', async () => {
    const req = postReq('/api/content', {
      file: 'website/public/data/teams.json',
      content: {
        sections: [{
          id: 'seniors',
          name: 'Senior Teams',
          subtitle: null,
          icon: null,
          logo: 'logo.png',
          teams: [{
            name: 'First XI',
            description: 'Top team',
            manager: 'Dave',
            coach: 'Eve',
            contact: 'dave@club.com',
            photo: 'photo.jpg',
            slug: 'first-xi',
            sidebar: true,
            managerLabel: 'Head Coach',
            coachLabel: 'Assistant',
          }, {
            name: 'Second XI',
            description: '',
          }],
        }],
      },
    });
    const ctx = makeContext(req, { env: { DB: makeDb({ all: [[]] }) } });
    const res = await contentPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });
});
