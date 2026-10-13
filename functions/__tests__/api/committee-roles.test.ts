/**
 * Route guards per committee role (#79).
 *
 * Each row calls a real handler with a role's session and checks only the
 * guard's verdict: refused (403) or let through (anything but 401/403). The
 * handlers run against the shared fake D1, so a let-through request may fail
 * further on; that's outside what this suite asserts.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  makeContext, makeDb, adminSession, treasurerSession, secretarySession,
  managerSession, memberSession, getReq, postReq, patchReq,
} from '../test-utils';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from '../../lib/permissions';
import * as websitePermissions from '../../../website/src/lib/permissions';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as subscriptionLevelsGet } from '../../api/admin/subscription-levels';
import { onRequestPost as manualPaymentPost } from '../../api/admin/manual-payment';
import { onRequestGet as registrationsGet } from '../../api/admin/registrations';
import { onRequestPost as newsPost } from '../../api/news';
import { onRequestPost as importPlayersPost } from '../../api/admin/import-players';
import { onRequestGet as secretsGet } from '../../api/admin/secrets';
import { onRequestGet as usersGet } from '../../api/admin/users';
import { onRequestPatch as clubPatch } from '../../api/club';

type Handler = (ctx: any) => Promise<Response>;
const sessions = {
  admin: adminSession,
  treasurer: treasurerSession,
  secretary: secretarySession,
  manager: managerSession,
  member: memberSession,
} as const;
type Role = keyof typeof sessions;

const CLUB = { 'X-Club-Slug': 'test-club' };
const routes: Array<{ name: string; handler: Handler; req: () => Request; allowed: Role[] }> = [
  { name: 'subscription levels (payments)', handler: subscriptionLevelsGet as Handler, req: () => getReq('/api/admin/subscription-levels'), allowed: ['admin', 'treasurer'] },
  { name: 'manual payment (payments)', handler: manualPaymentPost as Handler, req: () => postReq('/api/admin/manual-payment', {}), allowed: ['admin', 'treasurer'] },
  { name: 'club registrations (payments or members)', handler: registrationsGet as Handler, req: () => getReq('/api/admin/registrations'), allowed: ['admin', 'treasurer', 'secretary'] },
  { name: 'news (content)', handler: newsPost as Handler, req: () => postReq('/api/news', {}), allowed: ['admin', 'secretary'] },
  { name: 'customise save (content)', handler: clubPatch as Handler, req: () => patchReq('/api/club', { name: 'X' }, CLUB), allowed: ['admin', 'secretary'] },
  { name: 'publish/unpublish (publish)', handler: clubPatch as Handler, req: () => patchReq('/api/club', { published: true }, CLUB), allowed: ['admin'] },
  { name: 'import players (members)', handler: importPlayersPost as Handler, req: () => postReq('/api/admin/import-players', {}), allowed: ['admin', 'secretary'] },
  { name: 'API secrets (admin only)', handler: secretsGet as Handler, req: () => getReq('/api/admin/secrets'), allowed: ['admin'] },
  { name: 'user roles (admin only)', handler: usersGet as Handler, req: () => getReq('/api/admin/users'), allowed: ['admin'] },
];

async function statusFor(handler: Handler, req: Request): Promise<number | 'past-guard'> {
  try {
    const res = await handler(makeContext(req, { env: { DB: makeDb() as any } }));
    return res.status;
  } catch {
    // The fake DB can't satisfy every handler past its guard; reaching it is the point.
    return 'past-guard';
  }
}

describe('committee role route guards (#79)', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const route of routes) {
    for (const role of Object.keys(sessions) as Role[]) {
      const allowed = route.allowed.includes(role);
      it(`${role} is ${allowed ? 'let through' : 'refused'} on ${route.name}`, async () => {
        mockGetSession.mockResolvedValue(sessions[role]);
        const status = await statusFor(route.handler, route.req());
        if (allowed) {
          expect(status).not.toBe(401);
          expect(status).not.toBe(403);
        } else {
          expect(status).toBe(403);
        }
      });
    }
  }

  it('refuses a committee member acting on another club', async () => {
    mockGetSession.mockResolvedValue({
      ...treasurerSession,
      user: { ...treasurerSession.user, clubSlug: 'other-club' },
    });
    expect(await statusFor(subscriptionLevelsGet as Handler, getReq('/api/admin/subscription-levels'))).toBe(403);
  });
});

describe('permission table', () => {
  it('gives admin every permission and the committee roles only their own', () => {
    expect(ROLE_PERMISSIONS.admin).toEqual(PERMISSIONS);
    expect(ROLE_PERMISSIONS.treasurer).toEqual(['payments']);
    expect(ROLE_PERMISSIONS.secretary).toEqual(['content', 'members']);
    expect(ROLE_PERMISSIONS.manager).toEqual([]);
    expect(ROLE_PERMISSIONS.member).toEqual([]);
  });

  it('keeps publish admin-only', () => {
    const holders = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('publish')).map(([r]) => r);
    expect(holders).toEqual(['admin']);
  });

  it('grants nothing to an unknown or missing role', () => {
    expect(hasPermission('superuser', 'payments')).toBe(false);
    expect(hasPermission(undefined, ['payments', 'content'])).toBe(false);
  });

  it('matches the website copy exactly', () => {
    expect(websitePermissions.PERMISSIONS).toEqual(PERMISSIONS);
    expect(websitePermissions.COMMITTEE_ROLES).toEqual(['admin', 'treasurer', 'secretary', 'manager', 'member']);
    expect(websitePermissions.ROLE_PERMISSIONS).toEqual(ROLE_PERMISSIONS);
  });
});

import { onRequestPatch as memberDataPatch, onRequestDelete as memberDataDelete } from '../../api/admin/member-data';
import { onRequestPatch as teamsPatch } from '../../api/teams';

describe('secretary member management stops at the committee (#79)', () => {
  beforeEach(() => vi.clearAllMocks());
  const body = { name: 'New Name', email: 'new@example.com' };

  it("refuses a secretary editing an admin's account", async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    const db = makeDb({ first: [{ id: 'u9', role: 'admin' }] });
    const res = await memberDataPatch(makeContext(
      patchReq('/api/admin/member-data?userId=u9', body), { env: { DB: db as any } },
    ) as any);
    expect(res.status).toBe(403);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("refuses a secretary deleting a treasurer's account", async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    const db = makeDb({ first: [{ role: 'treasurer' }] });
    const res = await memberDataDelete(makeContext(
      new Request('https://example.com/api/admin/member-data?userId=u9', { method: 'DELETE', headers: CLUB }),
      { env: { DB: db as any } },
    ) as any);
    expect(res.status).toBe(403);
  });

  it("lets a secretary correct a plain member's account", async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    const db = makeDb({ first: [{ id: 'u9', role: 'member' }, null] });
    const res = await memberDataPatch(makeContext(
      patchReq('/api/admin/member-data?userId=u9', body), { env: { DB: db as any } },
    ) as any);
    expect(res.status).toBe(200);
  });

  it("still lets an admin correct another admin's account", async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [{ id: 'u9', role: 'admin' }, null] });
    const res = await memberDataPatch(makeContext(
      patchReq('/api/admin/member-data?userId=u9', body), { env: { DB: db as any } },
    ) as any);
    expect(res.status).toBe(200);
  });
});

describe('team moves stay inside the club', () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses moving a team into another club's section", async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    // Team found in this club; destination section not found in this club.
    const db = makeDb({ first: [{ id: 't1' }, null] });
    const res = await teamsPatch(makeContext(
      patchReq('/api/teams?type=team&id=t1', { sectionId: 'sec-other-club' }, CLUB),
      { env: { DB: db as any } },
    ) as any);
    expect(res.status).toBe(404);
  });
});
