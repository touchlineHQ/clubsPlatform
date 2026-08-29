#!/usr/bin/env node
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractEvents, readRegistry, REGISTRY_PATH } from './posthog-events.mjs';

/**
 * Regenerate .posthog-events.json from source.
 *
 * Existing descriptions are preserved — they are hand-written and worth more
 * than anything derivable from the code. New events land with an empty
 * description, which the drift test rejects, so adding an event forces you to
 * say what it means.
 *
 *   npm run posthog:events
 */

const root = process.cwd();
const found = extractEvents(root);

const existing = existsSync(join(root, REGISTRY_PATH)) ? readRegistry(root) : [];
const descriptions = new Map(existing.map((e) => [e.event, e.description ?? '']));

const registry = [...found.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([event, files]) => ({
    event,
    description: descriptions.get(event) ?? '',
    files: files.sort(),
  }));

writeFileSync(join(root, REGISTRY_PATH), `${JSON.stringify(registry, null, 2)}\n`);

const undocumented = registry.filter((e) => !e.description);
console.log(`Wrote ${REGISTRY_PATH}: ${registry.length} events`);
if (undocumented.length) {
  console.log(`\n${undocumented.length} need a description:`);
  for (const e of undocumented) console.log(`  - ${e.event}`);
  process.exitCode = 1;
}
