import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, decryptTransport, getSecret } from '../../lib/secrets';
import type { Env } from '../../lib/api-helpers';
import type { D1Database } from '@cloudflare/workers-types';

// Valid 32-byte AES-256-GCM key encoded as 64 hex chars
const TEST_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ASSETS: { fetch: async () => new Response() },
    BETTER_AUTH_SECRET: 'secret',
    SECRETS_ENCRYPTION_KEY: TEST_KEY,
    SECRETS_TRANSPORT_PRIVATE_KEY: '',
    SECRETS_TRANSPORT_PUBLIC_KEY: '',
    ...overrides,
  };
}

function toBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── encryptSecret ────────────────────────────────────────────────────────────

describe('encryptSecret', () => {
  it('returns a non-empty encryptedValue and iv', async () => {
    const result = await encryptSecret(makeEnv(), 'hello world');
    expect(result.encryptedValue).toBeTruthy();
    expect(result.iv).toBeTruthy();
  });

  it('encryptedValue and iv are base64url-encoded strings', async () => {
    const result = await encryptSecret(makeEnv(), 'test');
    expect(result.encryptedValue).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(result.iv).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('produces a different iv on each call (random IV)', async () => {
    const env = makeEnv();
    const r1 = await encryptSecret(env, 'same plaintext');
    const r2 = await encryptSecret(env, 'same plaintext');
    expect(r1.iv).not.toBe(r2.iv);
    expect(r1.encryptedValue).not.toBe(r2.encryptedValue);
  });
});

// ─── decryptSecret ────────────────────────────────────────────────────────────

describe('decryptSecret', () => {
  it('round-trips: decrypt(encrypt(x)) === x', async () => {
    const env = makeEnv();
    const plaintext = 'my-secret-api-key-12345';
    const { encryptedValue, iv } = await encryptSecret(env, plaintext);
    expect(await decryptSecret(env, encryptedValue, iv)).toBe(plaintext);
  });

  it('handles empty string plaintext', async () => {
    const env = makeEnv();
    const { encryptedValue, iv } = await encryptSecret(env, '');
    expect(await decryptSecret(env, encryptedValue, iv)).toBe('');
  });

  it('handles unicode / special characters', async () => {
    const env = makeEnv();
    const plaintext = '🔑 secret: "hello & world" <test>';
    const { encryptedValue, iv } = await encryptSecret(env, plaintext);
    expect(await decryptSecret(env, encryptedValue, iv)).toBe(plaintext);
  });

  it('throws when decrypting with the wrong key', async () => {
    const env = makeEnv();
    const { encryptedValue, iv } = await encryptSecret(env, 'secret');
    const wrongKeyEnv = makeEnv({ SECRETS_ENCRYPTION_KEY: 'b'.repeat(64) });
    await expect(decryptSecret(wrongKeyEnv, encryptedValue, iv)).rejects.toThrow();
  });
});

// ─── decryptTransport ────────────────────────────────────────────────────────

describe('decryptTransport', () => {
  it('decrypts a value that was encrypted with the matching RSA public key', async () => {
    // Generate a fresh RSA-OAEP key pair for this test
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );

    const privKeyDer = await crypto.subtle.exportKey('pkcs8', privateKey);
    const privKeyB64 = btoa(String.fromCharCode(...new Uint8Array(privKeyDer)));

    // Simulate what the browser would do: encrypt with the public key
    const plaintext = 'gocardless-access-token-abc123';
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      new TextEncoder().encode(plaintext),
    );
    const encryptedB64url = toBase64url(encryptedBuf);

    const env = makeEnv({ SECRETS_TRANSPORT_PRIVATE_KEY: privKeyB64 });
    const result = await decryptTransport(env, encryptedB64url);
    expect(result).toBe(plaintext);
  });
});

// ─── getSecret ───────────────────────────────────────────────────────────────

describe('getSecret', () => {
  it('returns null when no row is found', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    expect(await getSecret(db, makeEnv(), 'my-club', 'GC_ACCESS_TOKEN')).toBeNull();
  });

  it('decrypts and returns the secret value when a row is found', async () => {
    const env = makeEnv();
    const { encryptedValue, iv } = await encryptSecret(env, 'live-secret-value');

    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({ encryptedValue, iv }) }),
      }),
    } as unknown as D1Database;

    const result = await getSecret(db, env, 'my-club', 'GC_ACCESS_TOKEN');
    expect(result).toBe('live-secret-value');
  });
});
