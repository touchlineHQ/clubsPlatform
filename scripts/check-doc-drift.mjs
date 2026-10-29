#!/usr/bin/env node
import { checkDocs, docFiles, formatProblems } from './doc-drift.mjs';

/**
 * Fail if a doc under docs/ or .claude/skills/*\/SKILL.md makes a concrete
 * claim (path, command, table, env var) the code no longer backs.
 *
 *   npm run docs:check
 */

const root = process.cwd();
const files = docFiles(root);
const problems = checkDocs(root, files);

if (problems.length > 0) {
  console.error(`Doc drift: ${problems.length} claim(s) no longer match the code.\n${formatProblems(problems)}`);
  console.error('\nUpdate the doc, or restore what it describes.');
  process.exit(1);
}
console.log(`Doc drift check passed (${files.length} docs).`);
