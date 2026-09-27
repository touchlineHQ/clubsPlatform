/**
 * Ambient types for the plain `.mjs` helper shared by
 * `scripts/generate-posthog-events.mjs` and the drift test. Keeps the helper
 * as JavaScript (the generator runs under plain Node) while giving the
 * typechecked suite a real module shape — no `@ts-expect-error` needed.
 *
 * Named `.d.mts` because moduleResolution bundler strips the `.mjs` import
 * extension and looks for `.mts` / `.d.mts` before falling back to the `.mjs`.
 */
export function extractEvents(repoRoot: string): Map<string, string[]>;
export function readRegistry(
  repoRoot: string,
): Array<{ event: string; description: string; files: string[] }>;
export const REGISTRY_PATH: string;
export function relative(from: string, to: string): string;
