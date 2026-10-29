import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Deterministic drift check between the docs agents build from and the code
 * they describe. Shared by `scripts/check-doc-drift.mjs` (CLI, `npm run
 * docs:check`) and `functions/__tests__/doc-drift.test.ts` (runs in CI under
 * `npm run test:coverage`).
 *
 * Only concrete, checkable claims are verified; prose is left alone:
 *   - repo-rooted paths in backticks (`migrations/0011_add_player_tables.sql`)
 *   - bare source filenames in backticks (`ImportPlayersPanel.test.tsx`)
 *   - table names in the first column of a `| Table |` markdown table
 *   - SCREAMING_SNAKE env vars/flags (`ALLOW_CLUB_SELF_REGISTER`)
 *   - `npm run <script>` and `make <target>` commands
 *   - SKILL.md `references/*.md` links, in both directions
 *
 * Scope: every *.md under docs/ and each .claude/skills/<name>/SKILL.md. The
 * skills' references/ files are vendored upstream (PostHog) docs about other
 * projects' code, so only their listing in SKILL.md is checked.
 */

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage', 'test-results', 'playwright-report']);
const ROOT_DIRS = ['migrations', 'functions', 'website', 'scripts', 'e2e', 'docs', '.github', '.claude'];
const SOURCE_EXT = /\.(ts|tsx|sql|mjs|yaml|yml|toml)$/;
const CODE_DIRS = ['functions', 'website/src', 'e2e', 'scripts', '.github', 'migrations'];

function walk(root, dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** Docs under check, as repo-relative paths. */
export function docFiles(root) {
  const docs = existsSync(join(root, 'docs')) ? walk(root, 'docs').filter((f) => f.endsWith('.md')) : [];
  const skillsDir = join(root, '.claude/skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir)
        .map((s) => `.claude/skills/${s}/SKILL.md`)
        .filter((f) => existsSync(join(root, f)))
    : [];
  return [...docs, ...skills];
}

function tableNames(root) {
  const names = new Set();
  const dir = join(root, 'migrations');
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?/gi)) names.add(m[1]);
    for (const m of sql.matchAll(/RENAME TO\s+"?(\w+)"?/gi)) names.add(m[1]);
  }
  return names;
}

function codeCorpus(root) {
  let text = '';
  for (const d of CODE_DIRS) {
    if (!existsSync(join(root, d))) continue;
    for (const f of walk(root, d)) if (/\.(ts|tsx|mjs|toml|ya?ml|json)$/.test(f)) text += `${readFileSync(join(root, f), 'utf8')}\n`;
  }
  const wrangler = join(root, 'wrangler.toml');
  if (existsSync(wrangler)) text += readFileSync(wrangler, 'utf8');
  return text;
}

function makeTargets(root) {
  const f = join(root, 'Makefile');
  if (!existsSync(f)) return new Set();
  return new Set([...readFileSync(f, 'utf8').matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1]));
}

function npmScripts(root) {
  const f = join(root, 'package.json');
  return new Set(existsSync(f) ? Object.keys(JSON.parse(readFileSync(f, 'utf8')).scripts ?? {}) : []);
}

/** Returns a list of `{ file, line, claim, message }` for every claim that no longer holds. */
export function checkDocs(root, files = docFiles(root)) {
  const problems = [];
  const all = walk(root, '');
  const baseNames = new Set(all.map((f) => basename(f)));
  const tables = tableNames(root);
  const makes = makeTargets(root);
  const scripts = npmScripts(root);
  let corpus;

  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    const fail = (i, claim, message) => problems.push({ file, line: i + 1, claim, message });
    let fence = null; // open code fence: { char, len }
    let tableHeader = null;

    lines.forEach((line, i) => {
      // CommonMark: a fence closes only on the same character, at least as long, with nothing after it.
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1][0] === fence.char && marker[1].length >= fence.len && marker[2].trim() === '') fence = null;
        return;
      }
      if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = { char: marker[1][0], len: marker[1].length };
        return;
      }

      const isRow = /^\s*\|/.test(line);
      const cells = isRow ? line.split('|').slice(1, -1).map((c) => c.trim()) : [];
      if (isRow && tableHeader === null) tableHeader = cells[0];
      if (!isRow) tableHeader = null;

      if (isRow && tableHeader?.toLowerCase() === 'table' && cells[0] !== 'Table' && !/^-+$/.test(cells[0])) {
        for (const m of cells[0].matchAll(/`(\w+)`/g)) {
          if (!tables.has(m[1])) fail(i, m[1], `table \`${m[1]}\` is not created by any migration`);
        }
      }

      for (const [, token] of line.matchAll(/`([^`\n]+)`/g)) {
        const p = token.replace(/:\d+(-\d+)?$/, '');
        if (/[*<>{}\s]/.test(p)) {
          const cmd = token.match(/^(?:npm run|make)\s+([\w:.-]+)/);
          if (cmd) {
            const ok = token.startsWith('make') ? makes.has(cmd[1]) : scripts.has(cmd[1]);
            if (!ok) fail(i, token, `\`${token}\` names a ${token.startsWith('make') ? 'Makefile target' : 'package.json script'} that does not exist`);
          }
          continue;
        }
        if (ROOT_DIRS.some((d) => p.startsWith(`${d}/`))) {
          if (!existsSync(join(root, p))) fail(i, p, `path \`${p}\` does not exist`);
        } else if (SOURCE_EXT.test(p) && !p.includes('/')) {
          if (!baseNames.has(p)) fail(i, p, `file \`${p}\` does not exist anywhere in the repo`);
        } else if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(p)) {
          corpus ??= codeCorpus(root);
          if (!corpus.includes(p)) fail(i, p, `\`${p}\` is not referenced by any code or config`);
        }
      }
    });

    if (file.endsWith('/SKILL.md')) {
      const dir = dirname(file);
      const text = lines.join('\n');
      const linked = new Set([...text.matchAll(/`(references\/[^`\s]+)`/g)].map((m) => m[1]));
      for (const ref of linked) {
        if (!existsSync(join(root, dir, ref))) {
          const i = lines.findIndex((l) => l.includes(ref));
          fail(i, ref, `${file} lists \`${ref}\` but the file does not exist`);
        }
      }
      const refDir = join(root, dir, 'references');
      if (existsSync(refDir)) {
        for (const f of readdirSync(refDir)) {
          if (!linked.has(`references/${f}`)) fail(0, f, `references/${f} exists but ${file} does not list it`);
        }
      }
    }
  }
  return problems;
}

export function formatProblems(problems) {
  return problems.map((p) => `${p.file}:${p.line}  ${p.message}`).join('\n');
}

