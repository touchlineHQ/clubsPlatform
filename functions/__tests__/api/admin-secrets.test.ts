import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, getReq, postReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/secrets', () => ({
  decryptTransport: vi.fn(async () => 'plain-secret'),
  encryptSecret: vi.fn(async () => ({ encryptedValue: 'enc', iv: 'iv123' })),
}));

// ─── admin/secrets ────────────────────────────────────────────────────────────

import { onRequestGet, onRequestPost, onRequestDelete } from '../../api/admin/secrets';

describe('GET /api/admin/secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns list of secret keys and public key from env', async () => {
    const secretRows = [{ id: 's1', key: 'GC_ACCESS_TOKEN', updatedAt: 1000 }];
    const ctx = makeContext(getReq('/api/admin/secrets'), {
      env: {
        DB: makeDb({ all: [secretRows] }) as any,
        SECRETS_TRANSPORT_PUBLIC_KEY: 'pubkeybase64',
      },
    });

    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.secrets)).toBe(true);
    expect(body.secrets[0].key).toBe('GC_ACCESS_TOKEN');
    expect(body.secrets[0].id).toBe('s1');
    expect(body.publicKey).toBe('pubkeybase64');
  });

  it('returns empty secrets list when none stored', async () => {
    const ctx = makeContext(getReq('/api/admin/secrets'), {
      env: {
        DB: makeDb({ all: [[]] }) as any,
        SECRETS_TRANSPORT_PUBLIC_KEY: 'pubkeybase64',
      },
    });

    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.secrets).toHaveLength(0);
    expect(body.publicKey).toBe('pubkeybase64');
  });

  it('returns null publicKey when env var is not set', async () => {
    const ctx = makeContext(getReq('/api/admin/secrets'), {
      env: {
        DB: makeDb({ all: [[]] }) as any,
        SECRETS_TRANSPORT_PUBLIC_KEY: '',
      },
    });

    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    // empty string is falsy → handler returns null
    expect(body.publicKey).toBeNull();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(getReq('/api/admin/secrets'), {
      env: { DB: makeDb() as any },
    });

    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('stores a new secret and returns ok', async () => {
    const ctx = makeContext(
      postReq('/api/admin/secrets', { key: 'GC_ACCESS_TOKEN', encryptedValue: 'rsa-encrypted-base64' }),
      {
        env: {
          DB: makeDb({ run: { meta: { changes: 1 } } }) as any,
          SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          SECRETS_TRANSPORT_PRIVATE_KEY: 'private-key-base64',
        },
      },
    );

    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when key is not an allowed key', async () => {
    const ctx = makeContext(
      postReq('/api/admin/secrets', { key: 'UNKNOWN_KEY', encryptedValue: 'rsa-encrypted-base64' }),
      {
        env: {
          DB: makeDb() as any,
          SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          SECRETS_TRANSPORT_PRIVATE_KEY: 'private-key-base64',
        },
      },
    );

    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/key/i);
  });

  it('returns 400 when encryptedValue is missing', async () => {
    const ctx = makeContext(
      postReq('/api/admin/secrets', { key: 'GC_ACCESS_TOKEN' }),
      {
        env: {
          DB: makeDb() as any,
          SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          SECRETS_TRANSPORT_PRIVATE_KEY: 'private-key-base64',
        },
      },
    );

    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/encryptedValue/i);
  });

  it('returns 500 when SECRETS_ENCRYPTION_KEY is not configured', async () => {
    const ctx = makeContext(
      postReq('/api/admin/secrets', { key: 'GC_ACCESS_TOKEN', encryptedValue: 'rsa-encrypted-base64' }),
      {
        env: {
          DB: makeDb() as any,
          SECRETS_ENCRYPTION_KEY: undefined as any,
          SECRETS_TRANSPORT_PRIVATE_KEY: 'private-key-base64',
        },
      },
    );

    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toMatch(/SECRETS_ENCRYPTION_KEY/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      postReq('/api/admin/secrets', { key: 'GC_ACCESS_TOKEN', encryptedValue: 'rsa-encrypted-base64' }),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/admin/secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deletes a secret by key and returns ok', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/secrets?key=GC_ACCESS_TOKEN'),
      { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) as any } },
    );

    const res = await onRequestDelete(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when key is not an allowed key', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/secrets?key=UNKNOWN_KEY'),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/key/i);
  });

  it('returns 400 when key query param is missing', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/secrets'),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      deleteReq('/api/admin/secrets?key=GC_ACCESS_TOKEN'),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});
