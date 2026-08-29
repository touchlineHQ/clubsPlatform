import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Single source of truth for "which PostHog events does this codebase send?".
 *
 * Shared by the registry generator (npm run posthog:events) and the drift test,
 * so the two can never disagree about what counts as an event.
 */

const SCAN = [
  { dir: 'functions', exts: ['.ts'] },
  { dir: 'website/src', exts: ['.ts', '.tsx'] },
];

const SKIP_DIR = /(^|\/)(__tests__|node_modules|dist|coverage)(\/|$)/;

/** Backend: `event: 'name'` or `event: \`gc mandate ${ev.action}\`` */
const BACKEND = /\bevent:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g;
/** Frontend: `captureEvent('name'` */
const FRONTEND = /\bcaptureEvent\(\s*'([^']+)'/g;

function walk(root, dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry}`;
    if (SKIP_DIR.test(rel)) continue;
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) walk(root, rel, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(rel);
  }
  return out;
}

/**
 * A template-literal event name becomes a wildcard: `gc mandate ${ev.action}`
 * is registered as `gc mandate *`. The action comes from GoCardless, so the
 * concrete names cannot be enumerated from source.
 */
function normalise(name) {
  return name.replace(/\$\{[^}]*\}/g, '*').trim();
}

/** @returns {Map<string, string[]>} event name → files that send it */
export function extractEvents(repoRoot) {
  const found = new Map();

  for (const { dir, exts } of SCAN) {
    for (const file of walk(repoRoot, dir, exts, [])) {
      const src = readFileSync(join(repoRoot, file), 'utf8');
      for (const re of [BACKEND, FRONTEND]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
          const name = normalise(m[1] ?? m[2] ?? m[3]);
          if (!name) continue;
          if (!found.has(name)) found.set(name, []);
          const files = found.get(name);
          if (!files.includes(file)) files.push(file);
        }
      }
    }
  }

  return found;
}

export const REGISTRY_PATH = '.posthog-events.json';

export function readRegistry(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, REGISTRY_PATH), 'utf8'));
}

export { relative };
