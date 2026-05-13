import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, postReq, patchReq, deleteReq, adminSession } from '../test-utils';

const mockGetSession = vi.fn().mockResolvedValue(adminSession);
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
}));

import { onRequestPost, onRequestPatch, onRequestDelete } from '../../api/teams';

describe('POST /api/teams', () => {
  beforeEach(() => { mockGetSession.mockResolvedValue(adminSession); });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(postReq('/api/teams', {}), { env: { DB: makeDb() as never } });
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 when body has no type field (type defaults to empty string)', async () => {
    const ctx = makeContext(postReq('/api/teams', {}), { env: { DB: makeDb() as never } });
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when section body has no name field', async () => {
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: 'seniors' }),
      { env: { DB: makeDb() as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when team body has no name field', async () => {
    const db = makeDb({ first: { id: 'section_1' } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'team', sectionId: 'section_1' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('creates team with null-but-defined optional fields (photo/slug/managerLabel/coachLabel)', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', {
        type: 'team',
        sectionId: 'section_1',
        name: 'First XI',
        photo: null,
        slug: null,
        managerLabel: null,
        coachLabel: null,
      }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(201);
  });

  it('creates a section and returns 201 with id', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: 'seniors', name: 'Seniors', subtitle: '', icon: 'fa-shield', logo: null, sortOrder: 0 }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    const body = await res.json() as { ok: boolean; id: string };
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^section_/);
  });

  it('returns 400 when sectionKey or name is missing', async () => {
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: '', name: '' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('creates a team under a valid section', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'team', sectionId: 'section_1', name: 'First XI', description: '', manager: 'Bob', coach: 'Alice', contact: 'coach@test.com', sortOrder: 0 }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    const body = await res.json() as { ok: boolean; id: string };
    expect(res.status).toBe(201);
    expect(body.id).toMatch(/^team_/);
  });

  it('returns 400 when team sectionId does not exist', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'team', sectionId: 'bad_id', name: 'First XI' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown type', async () => {
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/teams', { type: 'unknown' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('creates section without logo field (logo defaults to null)', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: 'seniors', name: 'Seniors' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(201);
  });

  it('creates section with a defined logo string', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: 'seniors', name: 'Seniors', logo: 'logo.png', sortOrder: 3 }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(201);
  });

  it('creates section with non-finite sortOrder (defaults to 0)', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', sectionKey: 'seniors', name: 'Seniors', sortOrder: 'bad' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(201);
  });

  it('returns 400 when section type is missing sectionKey field', async () => {
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/teams', { type: 'section', name: 'Seniors' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when team type is missing sectionId field', async () => {
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/teams', { type: 'team', name: 'First XI' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(400);
  });

  it('creates team with all optional fields populated', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', {
        type: 'team',
        sectionId: 'section_1',
        name: 'First XI',
        photo: 'photo.jpg',
        slug: 'first-xi',
        sidebar: true,
        managerLabel: 'Head Coach',
        coachLabel: 'Assistant Coach',
        sortOrder: 1,
      }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    const body = await res.json() as { ok: boolean; id: string };
    expect(res.status).toBe(201);
    expect(body.id).toMatch(/^team_/);
  });

  it('creates team with non-finite sortOrder (defaults to 0)', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      postReq('/api/teams', {
        type: 'team',
        sectionId: 'section_1',
        name: 'First XI',
        sortOrder: 'not-a-number',
      }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPost(ctx as never);
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/teams', () => {
  beforeEach(() => { mockGetSession.mockResolvedValue(adminSession); });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(patchReq('/api/teams?type=section&id=s1', {}), { env: { DB: makeDb() as never } });
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(401);
  });

  it('updates a section', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=section&id=section_1', { name: 'Updated Name' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    const body = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 when patching non-existent section', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq('/api/teams?type=section&id=bad_id', { name: 'X' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(404);
  });

  it('updates a team', async () => {
    const db = makeDb({ first: { id: 'team_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=team&id=team_1', { name: 'New Name' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('returns 400 when type/id query params are missing', async () => {
    const db = makeDb();
    const ctx = makeContext(
      patchReq('/api/teams', { name: 'X' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(400);
  });

  it('patches section with all field updates', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=section&id=section_1', {
        sectionKey: 'seniors-updated',
        name: 'Updated Seniors',
        subtitle: 'Adult Teams',
        icon: 'fa-shield',
        logo: 'logo.png',
        sortOrder: 2,
      }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('patches section with logo set to null', async () => {
    const db = makeDb({ first: { id: 'section_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=section&id=section_1', { logo: null }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('patches team with all field updates', async () => {
    const db = makeDb({ first: { id: 'team_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=team&id=team_1', {
        sectionId: 'section_2',
        name: 'Updated XI',
        description: 'New desc',
        manager: 'Bob',
        coach: 'Alice',
        contact: 'contact@club.com',
        photo: 'photo.jpg',
        slug: 'first-xi',
        sidebar: true,
        managerLabel: 'Head Coach',
        coachLabel: 'Assistant',
        sortOrder: 2,
      }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('patches team with photo and slug set to null', async () => {
    const db = makeDb({ first: { id: 'team_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/teams?type=team&id=team_1', { photo: null, slug: null, sidebar: false, managerLabel: null, coachLabel: null }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown patch type', async () => {
    const db = makeDb();
    const ctx = makeContext(
      patchReq('/api/teams?type=unknown&id=x', {}),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when patching non-existent team', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq('/api/teams?type=team&id=bad_id', { name: 'X' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/teams', () => {
  beforeEach(() => { mockGetSession.mockResolvedValue(adminSession); });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(deleteReq('/api/teams?type=section&id=s1'), { env: { DB: makeDb() as never } });
    const res = await onRequestDelete(ctx as never);
    expect(res.status).toBe(401);
  });

  it('deletes a section', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      deleteReq('/api/teams?type=section&id=section_1'),
      { env: { DB: db as never } },
    );
    const res = await onRequestDelete(ctx as never);
    const body = await res.json() as { ok: boolean; changes: number };
    expect(res.status).toBe(200);
    expect(body.changes).toBe(1);
  });

  it('deletes a team after verifying club ownership', async () => {
    const db = makeDb({ first: { id: 'team_1' }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      deleteReq('/api/teams?type=team&id=team_1'),
      { env: { DB: db as never } },
    );
    const res = await onRequestDelete(ctx as never);
    const body = await res.json() as { ok: boolean; changes: number };
    expect(res.status).toBe(200);
    expect(body.changes).toBe(1);
  });

  it('returns 400 when type/id query params are missing', async () => {
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/teams'),
      { env: { DB: db as never } },
    );
    const res = await onRequestDelete(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns ok with changes:0 when team to delete is not found', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      deleteReq('/api/teams?type=team&id=team_missing'),
      { env: { DB: db as never } },
    );
    const res = await onRequestDelete(ctx as never);
    const body = await res.json() as { ok: boolean; changes: number };
    expect(res.status).toBe(200);
    expect(body.changes).toBe(0);
  });

  it('returns 400 for unknown delete type', async () => {
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/teams?type=unknown&id=x'),
      { env: { DB: db as never } },
    );
    const res = await onRequestDelete(ctx as never);
    expect(res.status).toBe(400);
  });
});
