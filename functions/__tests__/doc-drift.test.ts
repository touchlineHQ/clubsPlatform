import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkDocs, docFiles, formatProblems } from '../../scripts/doc-drift.mjs';

/**
 * Stops the docs agents build from (docs/, .claude/skills/*\/SKILL.md) drifting
 * from the code they describe. The first block runs against the real repo and
 * is what fails CI; the second proves each kind of claim is actually caught,
 * using a throwaway repo so no real doc is touched.
 *
 * Run `npm run docs:check` for the same check without vitest.
 */

const ROOT = resolve(__dirname, '../..');

describe('real docs', () => {
  it('make no claim the code has stopped backing', () => {
    const problems = checkDocs(ROOT);
    expect(problems, `Doc drift:\n${formatProblems(problems)}`).toEqual([]);
  });

  it('covers docs/ and the skill entry points', () => {
    const files = docFiles(ROOT);
    expect(files).toContain('docs/DATA_PROTECTION.md');
    expect(files).toContain('.claude/skills/integration-javascript_node/SKILL.md');
  });
});

describe('claim detection', () => {
  let root: string;
  const put = (path: string, body: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  const check = (doc: string) => {
    put('docs/D.md', doc);
    return checkDocs(root, ['docs/D.md']).map((p) => p.claim);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'doc-drift-'));
    put('migrations/0001.sql', 'CREATE TABLE IF NOT EXISTS "player" (id TEXT);');
    put('functions/api/a.ts', "export const f = env.REAL_FLAG;");
    put('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    put('Makefile', 'dev:\n\techo hi\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes when every claim holds', () => {
    expect(
      check(
        [
          'See `functions/api/a.ts` and `a.ts`, run `npm run test` or `make dev`; flag `REAL_FLAG`.',
          '',
          '| Table | Notes |',
          '|-------|-------|',
          '| `player` | ok |',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('catches a moved path', () => {
    expect(check('See `functions/api/moved.ts`.')).toEqual(['functions/api/moved.ts']);
  });

  it('catches a missing bare filename', () => {
    expect(check('See `Gone.test.tsx`.')).toEqual(['Gone.test.tsx']);
  });

  it('catches a table no migration creates', () => {
    expect(check('| Table | Notes |\n|---|---|\n| `ghost` | x |')).toEqual(['ghost']);
  });

  it('catches an env var nothing references', () => {
    expect(check('Set `OLD_FLAG`.')).toEqual(['OLD_FLAG']);
  });

  it('catches missing npm scripts and make targets', () => {
    expect(check('Run `npm run nope` then `make nada`.')).toEqual(['npm run nope', 'make nada']);
  });

  it('ignores claims inside code fences', () => {
    expect(check('```\n`functions/api/moved.ts`\n```')).toEqual([]);
  });

  it('catches SKILL.md reference listing drift in both directions', () => {
    put('.claude/skills/s/SKILL.md', 'Read `references/a.md` and `references/gone.md`.');
    put('.claude/skills/s/references/a.md', 'x');
    put('.claude/skills/s/references/unlisted.md', 'x');
    const claims = checkDocs(root, ['.claude/skills/s/SKILL.md']).map((p) => p.claim);
    expect(claims.sort()).toEqual(['references/gone.md', 'unlisted.md']);
  });
});
