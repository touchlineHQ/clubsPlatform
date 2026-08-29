import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error — plain .mjs helper, shared with scripts/generate-posthog-events.mjs
import { extractEvents, readRegistry } from '../../scripts/posthog-events.mjs';

/**
 * Stops .posthog-events.json drifting from the code again.
 *
 * It had: 7 events listed against 33 capture calls in source, while the
 * setup report claimed 23. Nobody could tell which was right, so the registry
 * was worse than useless — it looked authoritative and wasn't.
 *
 * Run `npm run posthog:events` to regenerate after adding or removing an event.
 */

const ROOT = resolve(__dirname, '../..');

const inSource: Map<string, string[]> = extractEvents(ROOT);
const registry: Array<{ event: string; description: string; files: string[] }> = readRegistry(ROOT);

const sourceNames = [...inSource.keys()].sort();
const registryNames = registry.map((e) => e.event).sort();

describe('.posthog-events.json', () => {
  it('lists every event the code sends', () => {
    const missing = sourceNames.filter((n) => !registryNames.includes(n));
    expect(
      missing,
      `These events are captured in source but absent from the registry.\n` +
      `Run \`npm run posthog:events\` and describe them:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('lists no events the code no longer sends', () => {
    const stale = registryNames.filter((n) => !sourceNames.includes(n));
    expect(
      stale,
      `These events are in the registry but no longer captured anywhere.\n` +
      `Run \`npm run posthog:events\` to drop them:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  // A name alone doesn't tell you what fires the event or when. An undescribed
  // entry is how the old registry became untrustworthy.
  it('describes every event', () => {
    const undocumented = registry.filter((e) => !e.description?.trim()).map((e) => e.event);
    expect(
      undocumented,
      `These registry entries need a description:\n  ${undocumented.join('\n  ')}`,
    ).toEqual([]);
  });

  it('records where each event is sent from', () => {
    const noFiles = registry.filter((e) => !e.files?.length).map((e) => e.event);
    expect(noFiles).toEqual([]);

    for (const entry of registry) {
      expect(
        entry.files.sort(),
        `Registry file list for "${entry.event}" is out of date — run \`npm run posthog:events\`.`,
      ).toEqual(inSource.get(entry.event)?.sort());
    }
  });

  it('follows the lowercase, space-separated naming convention', () => {
    // Wildcards are allowed only as a trailing segment, for template-literal
    // names like `gc mandate ${ev.action}` whose suffix comes from GoCardless.
    const badly = registryNames.filter((n) => !/^[a-z0-9]+(?: [a-z0-9]+)*(?: \*)?$/.test(n));
    expect(
      badly,
      `These names break the convention used by the rest of the events:\n  ${badly.join('\n  ')}`,
    ).toEqual([]);
  });
});
