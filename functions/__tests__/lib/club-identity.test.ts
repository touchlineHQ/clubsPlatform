import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { clubLink, clubPath, getClubIdentity } from '../../lib/club-identity';
import { makeDb } from '../test-utils';

function dbReturning(row: unknown): D1Database {
  return makeDb({ first: row }) as unknown as D1Database;
}

describe('getClubIdentity', () => {
  it('reads the display name from the column', async () => {
    const identity = await getClubIdentity(
      dbReturning({ slug: 'east-leake', name: 'East Leake FC', data: null }),
      'east-leake',
    );
    expect(identity?.name).toBe('East Leake FC');
    expect(identity?.slug).toBe('east-leake');
  });

  it('reads reply-to out of the data blob, where it actually lives', async () => {
    const identity = await getClubIdentity(
      dbReturning({
        slug: 'east-leake',
        name: 'East Leake FC',
        data: JSON.stringify({ email: 'secretary@elfc.example', tagline: 'x' }),
      }),
      'east-leake',
    );
    expect(identity?.replyTo).toBe('secretary@elfc.example');
  });

  it('has no reply-to when the club has never filled its contact details in', async () => {
    // defaultClub() seeds email as an empty string, so this is the common case
    // for a club that has just been created.
    const identity = await getClubIdentity(
      dbReturning({ slug: 'new-club', name: 'New Club', data: JSON.stringify({ email: '' }) }),
      'new-club',
    );
    expect(identity?.replyTo).toBeNull();
  });

  it('has no reply-to when the stored address is not one', async () => {
    const identity = await getClubIdentity(
      dbReturning({ slug: 'c', name: 'C', data: JSON.stringify({ email: 'call the secretary' }) }),
      'c',
    );
    expect(identity?.replyTo).toBeNull();
  });

  it('still identifies the club when the data blob is malformed', async () => {
    const identity = await getClubIdentity(
      dbReturning({ slug: 'c', name: 'Club C', data: '{not json' }),
      'c',
    );
    expect(identity?.name).toBe('Club C');
    expect(identity?.replyTo).toBeNull();
  });

  it('returns null for a club that is not there', async () => {
    expect(await getClubIdentity(dbReturning(null), 'ghost')).toBeNull();
  });
});

describe('clubPath', () => {
  it('puts the club prefix ahead of the hash in multi-club mode', () => {
    // Without the prefix the recipient lands on the platform directory.
    expect(clubPath('east-leake', '/reset-password?token=abc', true))
      .toBe('/east-leake/#/reset-password?token=abc');
  });

  it('omits the prefix in single-club mode', () => {
    expect(clubPath('east-leake', '/reset-password', false)).toBe('/#/reset-password');
  });

  it('omits the prefix for a platform admin, who has no club', () => {
    expect(clubPath(null, '/reset-password', true)).toBe('/#/reset-password');
  });

  it('tolerates a route given without its leading slash', () => {
    expect(clubPath('c', 'login', true)).toBe('/c/#/login');
  });
});

describe('clubLink', () => {
  it('builds an absolute URL on the deployment origin', () => {
    expect(clubLink('https://clubs.example', 'east-leake', '/reset-password?token=a', true))
      .toBe('https://clubs.example/east-leake/#/reset-password?token=a');
  });

  it('discards any path already on the base URL', () => {
    expect(clubLink('https://clubs.example/api/auth', 'c', '/login', true))
      .toBe('https://clubs.example/c/#/login');
  });
});
