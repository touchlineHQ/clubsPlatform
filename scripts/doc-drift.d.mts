/**
 * Ambient types for `scripts/doc-drift.mjs`, so the typechecked suite gets a
 * real module shape. See `posthog-events.d.mts` for why this is `.d.mts`.
 */
export interface DocDriftProblem {
  file: string;
  line: number;
  claim: string;
  message: string;
}
export function docFiles(root: string): string[];
export function checkDocs(root: string, files?: string[]): DocDriftProblem[];
export function formatProblems(problems: DocDriftProblem[]): string;
