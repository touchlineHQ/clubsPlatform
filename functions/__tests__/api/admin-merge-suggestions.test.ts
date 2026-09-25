import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq, deleteReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

// Partial: the sampling thresholds stay real, only the capture is observed. A
// test read is fast and reports no rows_read, so it never samples — the wiring
// has to be asserted at the call rather than at the capture.
const reportReadCost = vi.hoisted(() => vi.fn());
vi.mock('../../lib/read-cost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/read-cost')>()),
  reportReadCost,
}));

// Null by default, so the writes under test take the same path they do on a
// deployment with no PostHog configured. One test hands back a client that
// rejects, to prove analytics cannot fail a write that already committed.
const getPostHog = vi.hoisted(() => vi.fn<[], unknown>(() => null));
vi.mock('../../lib/posthog', () => ({
  getPostHog,
  clubGroups: (slug?: string | null) => (slug ? { groups: { club: slug } } : {}),
}));

import {
  onRequestGet as listSuggestions,
  onRequestPost as dismissSuggestion,
  onRequestDelete as restoreSuggestion,
} from '../../api/admin/registration-merge-suggestions';

const CLUB = 'test-club';
const OTHER_CLUB = 'other-club';
const NOW = 1_700_000_000_000;
const PATH = '/api/admin/registration-merge-suggestions';

interface Suggestion {
  playerId: string;
  fanId: string;
  ageGroup: string;
  setSize: number;
  registrationIds: string[];
  teamNames: string[];
}

/**
 * Merge suggestions, computed over the whole club in SQL.
 *
 * The rules under test are the ones `website/src/utils/mergeSuggestions.ts`
 * spells out in JS — it is kept as the executable spec — so the cases here
 * deliberately mirror `website/src/__tests__/utils/mergeSuggestions.test.ts`.
 * Run against real SQLite rather than canned rows, because everything that can
 * go wrong here (the age-key normalisation, the two anti-joins, the keyset over
 * a GROUP BY) lives in the SQL and not in the handler.
 */

function seedPlayer(db: SqliteDb, id: string, fanId: string) {
  db.exec(`INSERT INTO "player" VALUES ('${id}','${fanId}',${NOW},${NOW})`);
}

function seedRegistration(
  db: SqliteDb,
  o: { id: string; player: string; team: string; age?: string | null; club?: string },
) {
  const age = o.age === null ? 'NULL' : `'${o.age ?? 'U15'}'`;
  db.exec(`INSERT INTO "player_registration" VALUES
    ('${o.id}','${o.club ?? CLUB}','${o.player}','${o.team}',${age},'2026-07-31','Registered',${NOW},${NOW})`);
}

/** Make `secondary` billed through `primary`, as POST /registration-merges does. */
function seedMerge(db: SqliteDb, secondary: string, primary: string, club = CLUB) {
  db.exec(`INSERT INTO "registration_merge" VALUES
    ('${club}','${secondary}','${primary}',${NOW},${NOW})`);
}

function seedDismissal(
  db: SqliteDb,
  o: { player: string; ageKey: string; setSize: number; club?: string },
) {
  db.exec(`INSERT INTO "registration_merge_suggestion_dismissal" VALUES
    ('${o.club ?? CLUB}','${o.player}','${o.ageKey}',${o.setSize},'user_1',${NOW})`);
}

/** One player with two registrations in one age group: the canonical candidate. */
function seedPair(db: SqliteDb, player: string, fanId: string, age = 'U15') {
  seedPlayer(db, player, fanId);
  seedRegistration(db, { id: `reg_${player}_tue`, player, team: 'U15 Tuesday', age });
  seedRegistration(db, { id: `reg_${player}_thu`, player, team: 'U15 Thursday', age });
}

describe('merge suggestions', () => {
  let sqlite: SqliteDb;
  let db: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    // clearAllMocks leaves implementations in place, so reset this one by hand
    // or a rejecting client would leak into every later test.
    getPostHog.mockReturnValue(null);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
  });
  afterEach(() => sqlite.close());

  const ctx = (request: Request, waitUntil?: (p: Promise<unknown>) => void) =>
    makeContext(request, { env: { DB: db as never }, ...(waitUntil ? { waitUntil } : {}) }) as never;

  const list = (query = '') =>
    listSuggestions(ctx(getReq(`${PATH}${query}`, { 'X-Club-Slug': CLUB })));

  const dismiss = (body: unknown, headers: Record<string, string> = { 'X-Club-Slug': CLUB }) =>
    dismissSuggestion(ctx(postReq(PATH, body, headers)));

  /** Dismiss a set the admin saw at `setSize`, which the server must agree with. */
  const dismissSeen = (playerId: string, ageGroup: string, setSize: number) =>
    dismiss({ playerId, ageGroup, setSize });

  const restore = (query: string) =>
    restoreSuggestion(ctx(deleteReq(`${PATH}${query}`, { 'X-Club-Slug': CLUB })));

  /** Restore a dismissal the admin saw at `setSize`, which the server must agree with. */
  const restoreSeen = (playerId: string, ageGroup: string, setSize: number) =>
    restore(`?playerId=${playerId}&ageGroup=${ageGroup}&setSize=${setSize}`);

  async function suggestions(query = ''): Promise<Suggestion[]> {
    const res = await list(query);
    expect(res.status).toBe(200);
    return (await res.json() as { suggestions: Suggestion[] }).suggestions;
  }

  function auditRows() {
    return sqlite
      .prepare(`SELECT "action","targetTable","targetId","oldStatus","newStatus","note"
                  FROM "admin_audit_log" ORDER BY "createdAt", "action"`)
      .all() as Record<string, string | null>[];
  }

  // ─── Guards ─────────────────────────────────────────────────────────────────

  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
  });

  it('refuses a request with no club header', async () => {
    const res = await listSuggestions(ctx(getReq(PATH)));
    expect(res.status).toBe(400);
  });

  it('refuses an unknown state rather than silently listing the open ones', async () => {
    const res = await list('?state=elsewhere');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('unknown state');
  });

  it('refuses an unknown sort key rather than interpolating it', async () => {
    const res = await list(`?sort=fanId'--`);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('unknown sort key');
  });

  // ─── The grouping rules ─────────────────────────────────────────────────────

  it('suggests a pair of one player in one age group, billed separately', async () => {
    seedPair(sqlite, 'p1', 'FAN001');

    expect(await suggestions()).toEqual([
      {
        playerId: 'p1',
        fanId: 'FAN001',
        ageGroup: 'U15',
        setSize: 2,
        // Sorted by team name, so a page reads the same way twice.
        registrationIds: ['reg_p1_thu', 'reg_p1_tue'],
        teamNames: ['U15 Thursday', 'U15 Tuesday'],
      },
    ]);
  });

  it('says nothing once one of the pair is already merged', async () => {
    // Today's rule, preserved: a set is suggested only while every member is
    // billed separately. Once any is merged the admin has already ruled.
    seedPair(sqlite, 'p1', 'FAN001');
    seedMerge(sqlite, 'reg_p1_thu', 'reg_p1_tue');

    expect(await suggestions()).toEqual([]);
  });

  it("excludes a group's primary, not just its secondaries", async () => {
    // The case the second NOT EXISTS exists for. The primary is unmerged by the
    // registration_merge row's own definition, so a single anti-join on
    // registrationId would leave it a candidate and re-suggest the merge that
    // was just made.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday' });
    seedRegistration(sqlite, { id: 'reg_c', player: 'p1', team: 'U15 Sunday' });
    // reg_a is now a primary billing for reg_b; reg_c is loose.
    seedMerge(sqlite, 'reg_b', 'reg_a');

    // Only reg_c is a candidate, and one registration is not a set.
    expect(await suggestions()).toEqual([]);
  });

  it('never groups across age groups', async () => {
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday', age: 'U15' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U16 Thursday', age: 'U16' });

    expect(await suggestions()).toEqual([]);
  });

  it('treats casing and surrounding whitespace as one age group', async () => {
    // LOWER(TRIM(...)) must match normaliseAgeGroup exactly: age groups arrive
    // from an FA export, and a mismatch splits one set into two silently.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'A', age: ' U15 ' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'B', age: 'u15' });
    seedRegistration(sqlite, { id: 'reg_c', player: 'p1', team: 'C', age: 'U15' });

    const found = await suggestions();
    expect(found).toHaveLength(1);
    expect(found[0].setSize).toBe(3);
    expect(found[0].ageGroup).toBe('U15');
  });

  it('never makes a candidate of a blank or missing age group', async () => {
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'A', age: null });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'B', age: '' });
    seedRegistration(sqlite, { id: 'reg_c', player: 'p1', team: 'C', age: '   ' });

    expect(await suggestions()).toEqual([]);
  });

  it('never groups across players', async () => {
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedPlayer(sqlite, 'p2', 'FAN002');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p2', team: 'U15 Thursday' });

    expect(await suggestions()).toEqual([]);
  });

  it('never groups across clubs', async () => {
    // One player registered at two clubs is two clubs' business, and neither
    // admin may see the other's rows.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday', club: OTHER_CLUB });

    expect(await suggestions()).toEqual([]);
  });

  it('keeps a team name containing a comma intact', async () => {
    // Why the concatenated lists are separated on CHAR(31): a comma-joined list
    // of team names cannot be split back apart.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday, Thursday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Sunday' });

    const found = await suggestions();
    expect(found[0].teamNames).toEqual(['U15 Sunday', 'U15 Tuesday, Thursday']);
    expect(found[0].registrationIds).toEqual(['reg_b', 'reg_a']);
  });

  // ─── Dismissals ─────────────────────────────────────────────────────────────

  it('hides a dismissed set, and raises it again once it grows', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2 });

    expect(await suggestions()).toEqual([]);

    // A third registration is a question the admin has not answered.
    seedRegistration(sqlite, { id: 'reg_p1_sun', player: 'p1', team: 'U15 Sunday' });

    const found = await suggestions();
    expect(found).toHaveLength(1);
    expect(found[0].setSize).toBe(3);
  });

  it('keeps a dismissal to its own club', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2, club: OTHER_CLUB });

    expect(await suggestions()).toHaveLength(1);
  });

  it('dismisses a set, audits it, and stores the size the server counted', async () => {
    seedPair(sqlite, 'p1', 'FAN001');

    const res = await dismissSeen('p1', 'U15', 2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, setSize: 2 });

    expect(sqlite.prepare(`SELECT * FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{
        clubSlug: CLUB, playerId: 'p1', ageKey: 'u15', setSize: 2,
        dismissedBy: 'user_1', dismissedAt: expect.any(Number),
      }]);

    expect(auditRows()).toEqual([{
      action: 'merge_suggestion_dismissed',
      targetTable: 'player',
      targetId: 'p1',
      oldStatus: null,
      newStatus: 'u15:2',
      note: 'Kept separate in U15: U15 Thursday, U15 Tuesday',
    }]);

    expect(await suggestions()).toEqual([]);
  });

  it('normalises the age group it is given, so the client need not', async () => {
    seedPair(sqlite, 'p1', 'FAN001');

    expect((await dismissSeen('p1', ' u15 ', 2)).status).toBe(200);
    expect(await suggestions()).toEqual([]);
  });

  it('is idempotent, and re-dismissing a grown set records the larger size', async () => {
    seedPair(sqlite, 'p1', 'FAN001');

    expect((await dismissSeen('p1', 'U15', 2)).status).toBe(200);
    expect((await dismissSeen('p1', 'U15', 2)).status).toBe(200);

    const rows = () => sqlite
      .prepare(`SELECT "setSize" FROM "registration_merge_suggestion_dismissal"`)
      .all() as { setSize: number }[];
    expect(rows()).toEqual([{ setSize: 2 }]);

    seedRegistration(sqlite, { id: 'reg_p1_sun', player: 'p1', team: 'U15 Sunday' });
    expect((await dismissSeen('p1', 'U15', 3)).status).toBe(200);

    expect(rows()).toEqual([{ setSize: 3 }]);
    expect(await suggestions()).toEqual([]);
  });

  it('refuses a dismissal for a set that has grown since the admin saw it', async () => {
    // The case setSize exists for, and the one storing the server's own count
    // got backwards: an import lands between the banner loading and the click,
    // and the third registration must not be suppressed by a "no" that was
    // given about two. 409 hands back the current size so the client can reload.
    seedPair(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_p1_sun', player: 'p1', team: 'U15 Sunday' });

    const res = await dismissSeen('p1', 'U15', 2);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'this suggestion has changed since it was loaded',
      setSize: 3,
    });

    // Nothing written, so the grown set is still suggested.
    expect(sqlite.prepare(`SELECT * FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([]);
    expect((await suggestions())[0].setSize).toBe(3);
  });

  it('refuses a dismissal that names no size, or an impossible one', async () => {
    // A set of one is not a suggestion, and a body without a size could only
    // come from a caller that never saw the set.
    seedPair(sqlite, 'p1', 'FAN001');

    expect((await dismiss({ playerId: 'p1', ageGroup: 'U15' })).status).toBe(400);
    expect((await dismiss({ playerId: 'p1', ageGroup: 'U15', setSize: 1 })).status).toBe(400);
    expect((await dismiss({ playerId: 'p1', ageGroup: 'U15', setSize: 2.5 })).status).toBe(400);
  });

  it('refuses a dismissal for a set that is not a suggestion', async () => {
    // A dismissal for a set that does not exist would suppress a future one
    // silently. The stored size is the server's count, never the client's, so a
    // stale page cannot write a size that hides a larger set.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });

    const res = await dismissSeen('p1', 'U15', 2);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/no merge suggestion/);
    expect(sqlite.prepare(`SELECT * FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([]);
  });

  it('refuses a dismissal with no player or no age group', async () => {
    expect((await dismiss({ ageGroup: 'U15', setSize: 2 })).status).toBe(400);
    expect((await dismiss({ playerId: 'p1', setSize: 2 })).status).toBe(400);
    expect((await dismiss({ playerId: 'p1', ageGroup: '   ', setSize: 2 })).status).toBe(400);
  });

  it('lists dismissals with the age group as it is written on the registration', async () => {
    seedPair(sqlite, 'p1', 'FAN001', ' U15 ');
    await dismissSeen('p1', 'U15', 2);

    const res = await list('?state=dismissed');
    expect(res.status).toBe(200);
    expect((await res.json() as { suggestions: unknown[] }).suggestions).toEqual([{
      playerId: 'p1',
      fanId: 'FAN001',
      ageKey: 'u15',
      ageGroup: 'U15',
      setSize: 2,
      dismissedBy: 'user_1',
      dismissedAt: expect.any(Number),
    }]);
  });

  it('still lists a dismissal whose registrations have since gone', async () => {
    // A dismissal can outlive every registration it covered. Dropping it from
    // the list would leave a suppression the admin cannot undo.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2 });

    const listed = (await (await list('?state=dismissed')).json()) as { suggestions: Suggestion[] };
    expect(listed.suggestions).toHaveLength(1);
    // Falls back to the stored key, which is all there is left to show.
    expect(listed.suggestions[0].ageGroup).toBe('u15');
  });

  it('restores a dismissal, audits it, and the suggestion comes back', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    await dismissSeen('p1', 'U15', 2);
    expect(await suggestions()).toEqual([]);

    const res = await restoreSeen('p1', 'U15', 2);
    expect(res.status).toBe(200);

    expect(await suggestions()).toHaveLength(1);
    expect(auditRows().map((r) => r.action)).toEqual([
      'merge_suggestion_dismissed',
      'merge_suggestion_restored',
    ]);
    expect(auditRows()[1].oldStatus).toBe('u15:2');
  });

  /**
   * A D1 facade that mutates the database between a read and the batch.
   *
   * The restore handler reads the dismissal's size in its own round trip and
   * then writes, so the only way to exercise the window between them is to
   * change the row while the handler is inside it. `onRead` fires once, after
   * the first `.first()` resolves.
   */
  function racingDb(base: unknown, onRead: () => void) {
    let fired = false;
    const b = base as { prepare(sql: string): unknown; batch(s: unknown[]): unknown };
    return {
      prepare(sql: string) {
        const stmt = b.prepare(sql) as Record<string, unknown>;
        return {
          ...stmt,
          bind: (...params: unknown[]) => {
            const bound = (stmt.bind as (...p: unknown[]) => Record<string, unknown>)(...params);
            return {
              ...bound,
              first: async () => {
                const row = await (bound.first as () => Promise<unknown>)();
                if (!fired) { fired = true; onRead(); }
                return row;
              },
            };
          },
        };
      },
      batch: (statements: unknown[]) => b.batch(statements),
    };
  }

  it('refuses a dismissal that would replace a larger one written under it', async () => {
    // Two admins overlapping on the same set: one dismisses it at 2 while the
    // other, after a third registration lands, dismisses it at 3. The slower
    // size-2 write must not replace the size-3 decision — that would lose it and
    // put the set back in the review list.
    seedPair(sqlite, 'p1', 'FAN001');

    const raced = racingDb(db, () => {
      // The other admin's dismissal of the grown set, landing mid-request.
      sqlite.exec(`INSERT INTO "registration_merge_suggestion_dismissal"
                   VALUES ('${CLUB}','p1','u15',3,'user_2',${NOW})`);
    });

    const res = await dismissSuggestion(makeContext(
      postReq(PATH, { playerId: 'p1', ageGroup: 'U15', setSize: 2 }, { 'X-Club-Slug': CLUB }),
      { env: { DB: raced as never } },
    ) as never);

    expect(res.status).toBe(409);

    // The larger decision stands, with its own author.
    expect(sqlite.prepare(`SELECT "setSize","dismissedBy"
                             FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{ setSize: 3, dismissedBy: 'user_2' }]);
    // And nothing was logged as having taken effect.
    expect(auditRows()).toEqual([]);
  });

  it('still records a dismissal of a set that has since grown', async () => {
    // The monotonic guard must not block the legitimate direction: re-dismissing
    // the same set at a larger size replaces the smaller record.
    seedPair(sqlite, 'p1', 'FAN001');
    await dismissSeen('p1', 'U15', 2);
    seedRegistration(sqlite, { id: 'reg_p1_sun', player: 'p1', team: 'U15 Sunday' });

    expect((await dismissSeen('p1', 'U15', 3)).status).toBe(200);
    expect(sqlite.prepare(`SELECT "setSize" FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{ setSize: 3 }]);
  });

  it('refuses a restore of a dismissal that was re-made before the request arrived', async () => {
    // The window the handler's own read cannot see: the admin opened the
    // dismissed list showing a set of 2, another admin re-dismissed it at 3 after
    // a third registration landed, and only then did Restore get clicked.
    // Validating against the fresh read would compare 3 with 3 and delete a row
    // the admin never saw.
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 3 });

    const res = await restoreSeen('p1', 'U15', 2);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'this dismissal has changed since it was loaded',
      setSize: 3,
    });
    expect(sqlite.prepare(`SELECT "setSize" FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{ setSize: 3 }]);
    expect(auditRows()).toEqual([]);
  });

  it('refuses a restore that names no size', async () => {
    seedPlayer(sqlite, 'p1', 'FAN001');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2 });

    expect((await restore('?playerId=p1&ageGroup=U15')).status).toBe(400);
    expect((await restoreSeen('p1', 'U15', 1)).status).toBe(400);
  });

  it('refuses a restore whose dismissal was re-dismissed under it', async () => {
    // Two admins on the same set: one opens the dismissed list, the other
    // re-dismisses after a third registration arrives. An unconditional delete
    // by key would throw the newer decision away and log the older size as the
    // one it removed. The guard turns that into a refusal instead.
    seedPair(sqlite, 'p1', 'FAN001');
    await dismissSeen('p1', 'U15', 2);

    const raced = racingDb(db, () => {
      sqlite.exec(`UPDATE "registration_merge_suggestion_dismissal"
                      SET "setSize" = 3 WHERE "playerId" = 'p1'`);
    });

    const res = await restoreSuggestion(makeContext(
      deleteReq(`${PATH}?playerId=p1&ageGroup=U15&setSize=2`, { 'X-Club-Slug': CLUB }),
      { env: { DB: raced as never } },
    ) as never);

    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toMatch(/changed since it was loaded/);

    // The newer dismissal survives untouched, at its own size.
    expect(sqlite.prepare(`SELECT "setSize" FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{ setSize: 3 }]);
    // And nothing claims to have restored it.
    expect(auditRows().map((r) => r.action)).toEqual(['merge_suggestion_dismissed']);
  });

  it('reports a restore of something that was never dismissed', async () => {
    expect((await restoreSeen('p1', 'U15', 2)).status).toBe(404);
  });

  it('counts the club\'s dismissals on every page', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    seedPair(sqlite, 'p2', 'FAN002');
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2 });
    seedDismissal(sqlite, { player: 'p2', ageKey: 'u16', setSize: 2, club: OTHER_CLUB });

    const body = await (await list()).json() as { dismissedCount: number };
    expect(body.dismissedCount).toBe(1);
  });

  it('answers a dismissal that committed even when the analytics send fails', async () => {
    // The write is already committed by the time the capture runs, so awaiting
    // it would let a PostHog timeout answer 500 — and the banner would tell the
    // admin their decision did not land when it did. Off the response path via
    // waitUntil, with the rejection caught, exactly like reportReadCost.
    seedPair(sqlite, 'p1', 'FAN001');
    const sent: Promise<unknown>[] = [];
    getPostHog.mockReturnValue({
      captureImmediate: () => Promise.reject(new Error('posthog down')),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await dismissSuggestion(ctx(
      postReq(PATH, { playerId: 'p1', ageGroup: 'U15', setSize: 2 }, { 'X-Club-Slug': CLUB }),
      (p) => { sent.push(p); },
    ));

    expect(res.status).toBe(200);
    expect(sqlite.prepare(`SELECT "setSize" FROM "registration_merge_suggestion_dismissal"`).all())
      .toEqual([{ setSize: 2 }]);

    // Handed to waitUntil, and already carrying its own catch — so it resolves
    // rather than surfacing as an unhandled rejection.
    expect(sent).toHaveLength(1);
    await expect(sent[0]).resolves.toBeUndefined();
    consoleError.mockRestore();
  });

  // ─── Paging over the GROUP BY ───────────────────────────────────────────────

  /** Walk every page, returning the player ids in the order seen. */
  async function walk(limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const res = await list(
        `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { suggestions: Suggestion[]; nextCursor: string | null };
      seen.push(...body.suggestions.map((s) => s.playerId));
      cursor = body.nextCursor;
      if (!cursor) return seen;
    }
    throw new Error('paging did not terminate');
  }

  it('walks every suggestion exactly once across pages', async () => {
    // The assertion the keyset exists for. (playerId, ageKey) is the grouping
    // key, so the cursor names a position the GROUP BY can actually produce —
    // a tiebreak disagreeing with the ORDER BY shows up here and nowhere else.
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    players.forEach((p, i) => seedPair(sqlite, p, `FAN00${i}`));
    // One player with two age groups: two suggestions sharing a cursor value,
    // which is exactly what the ageKey tiebreak is for.
    seedRegistration(sqlite, { id: 'reg_p1_u16a', player: 'p1', team: 'U16 A', age: 'U16' });
    seedRegistration(sqlite, { id: 'reg_p1_u16b', player: 'p1', team: 'U16 B', age: 'U16' });

    for (const limit of [1, 2, 3, 6]) {
      const seen = await walk(limit);
      expect(seen).toHaveLength(6);
      expect([...seen].sort()).toEqual(['p1', 'p1', 'p2', 'p3', 'p4', 'p5']);
    }
  });

  it('gives the club-wide count on the first page and not on the rest', async () => {
    // The banner states the club's count, which the page cannot; and paging must
    // not re-pay for a number the banner already has.
    ['p1', 'p2', 'p3'].forEach((p, i) => seedPair(sqlite, p, `FAN00${i}`));

    const first = await (await list('?limit=2')).json() as
      { openCount?: number; nextCursor: string | null };
    expect(first.openCount).toBe(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await (await list(
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    )).json() as { openCount?: number };
    expect(second.openCount).toBeUndefined();
  });

  it('leaves a dismissed set out of the club-wide count too', async () => {
    ['p1', 'p2'].forEach((p, i) => seedPair(sqlite, p, `FAN00${i}`));
    seedDismissal(sqlite, { player: 'p1', ageKey: 'u15', setSize: 2 });

    const body = await (await list()).json() as { openCount: number };
    expect(body.openCount).toBe(1);
  });

  // ─── Telemetry ──────────────────────────────────────────────────────────────

  it('reports its read cost against its own rows threshold', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    await list();

    expect(reportReadCost).toHaveBeenCalledTimes(1);
    const [, userId, clubSlug, sample] = reportReadCost.mock.calls[0];
    expect(userId).toBe('user_1');
    expect(clubSlug).toBe(CLUB);
    expect(sample).toMatchObject({
      endpoint: 'merge_suggestions',
      // Above ROWS_READ_SAMPLE deliberately: this read groups the club by
      // design, so the page-shaped threshold would capture every call.
      rowsReadSample: 5000,
      rowsReturned: 1,
    });
    expect(sample.extra).toMatchObject({ state: 'open', paged: false, open_count: 1 });
  });

  it('reports the dismissals read too', async () => {
    await list('?state=dismissed');
    expect(reportReadCost.mock.calls[0][3]).toMatchObject({
      endpoint: 'merge_suggestions',
      rowsReadSample: 5000,
    });
  });

  it('carries no FAN number or team name into the sample', async () => {
    seedPair(sqlite, 'p1', 'FAN001');
    await list();

    const serialised = JSON.stringify(reportReadCost.mock.calls[0][3]);
    expect(serialised).not.toMatch(/FAN001/);
    expect(serialised).not.toMatch(/Tuesday/);
  });

  // ─── Schema ─────────────────────────────────────────────────────────────────

  it('carries the index the candidate scan depends on', () => {
    // ensure-tables and migrations/ are hand-synced copies; this catches an
    // index that reached the migration but not the runtime schema.
    const names = (sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`,
    ).all() as { name: string }[]).map((r) => r.name);

    expect(names).toEqual(expect.arrayContaining([
      'idx_player_registration_club_player_age',
    ]));
  });
});
