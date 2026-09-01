import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { loadClubIdentity, clubAppUrl } from '../../lib/club-identity';

function dbReturning(row: unknown): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => row) })),
    })),
  } as unknown as D1Database;
}

describe('loadClubIdentity', () => {
  it('returns null for a user with no club', async () => {
    expect(await loadClubIdentity(dbReturning(null), null)).toBeNull();
    expect(await loadClubIdentity(dbReturning(null), undefined)).toBeNull();
    expect(await loadClubIdentity(dbReturning(null), '')).toBeNull();
  });

  it('returns null when the club is not found or inactive', async () => {
    expect(await loadClubIdentity(dbReturning(null), 'gone')).toBeNull();
  });

  it('reads the name and the contact address out of the content blob', async () => {
    const db = dbReturning({ name: 'East Leake FC', data: JSON.stringify({ email: 'sec@elfc.com' }) });
    expect(await loadClubIdentity(db, 'east-leake')).toEqual({
      slug: 'east-leake',
      name: 'East Leake FC',
      replyTo: 'sec@elfc.com',
    });
  });

  it('has no reply-to when the club has not set a contact address', async () => {
    const db = dbReturning({ name: 'East Leake FC', data: JSON.stringify({ email: '   ' }) });
    expect((await loadClubIdentity(db, 'east-leake'))!.replyTo).toBeNull();
  });

  // A club whose blob is corrupt still gets its password resets.
  it('survives an unparseable content blob', async () => {
    const db = dbReturning({ name: 'East Leake FC', data: '{not json' });
    expect(await loadClubIdentity(db, 'east-leake')).toEqual({
      slug: 'east-leake',
      name: 'East Leake FC',
      replyTo: null,
    });
  });
});

describe('clubAppUrl', () => {
  it('puts the route in the fragment, because the app is a HashRouter', () => {
    expect(clubAppUrl({
      origin: 'https://clubs.example',
      clubSlug: 'east-leake',
      multiClub: false,
      route: '/reset-password',
    })).toBe('https://clubs.example/#/reset-password');
  });

  // Without the club prefix a multi-club link lands on the platform directory.
  it('prefixes the club slug in multi-club mode', () => {
    expect(clubAppUrl({
      origin: 'https://clubs.example',
      clubSlug: 'east-leake',
      multiClub: true,
      route: '/reset-password',
      query: { token: 'abc123' },
    })).toBe('https://clubs.example/east-leake/#/reset-password?token=abc123');
  });

  it('omits the prefix for a user with no club, even in multi-club mode', () => {
    expect(clubAppUrl({
      origin: 'https://clubs.example',
      clubSlug: null,
      multiClub: true,
      route: '/',
    })).toBe('https://clubs.example/#/');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(clubAppUrl({
      origin: 'https://clubs.example/',
      clubSlug: null,
      multiClub: false,
      route: '/login',
    })).toBe('https://clubs.example/#/login');
  });

  it('encodes query values', () => {
    const url = clubAppUrl({
      origin: 'https://clubs.example',
      clubSlug: null,
      multiClub: false,
      route: '/reset-password',
      query: { token: 'a+b/c=' },
    });
    expect(url).toContain('token=a%2Bb%2Fc%3D');
  });
});
