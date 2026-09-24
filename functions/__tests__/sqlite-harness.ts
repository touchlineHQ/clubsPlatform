import { createRequire } from "node:module";
import { TABLE_STATEMENTS } from "../lib/ensure-tables";

/**
 * A real SQLite database for tests that need SQL to actually run.
 *
 * The D1 double in test-utils returns canned rows and ignores the query, which
 * is the right trade for most handler tests — but it cannot tell a correct
 * query from one that returns the wrong rows, or from one that does not parse.
 * Anything whose correctness lives in the SQL itself belongs here instead.
 *
 * `node:sqlite` is built into Node 22, which is what package.json requires and
 * what all three CI workflows install, so this costs no dependency. It is
 * reached through createRequire because Vite tries to resolve `node:sqlite` as
 * a bare specifier and fails.
 *
 * This is not D1. It shares D1's engine and dialect, not its limits — the
 * 100-parameter bind cap and the subrequest budget are invisible here, so
 * assert those against the generated SQL, not against this.
 */
const require_ = createRequire(import.meta.url);

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function load(): { DatabaseSync: new (path: string) => SqliteDb } {
  try {
    return require_("node:sqlite");
  } catch (err) {
    throw new Error(
      "node:sqlite is unavailable — it needs Node 22 or newer, which is what "
        + `package.json's engines field requires. Got ${process.version}. (${String(err)})`,
    );
  }
}

/**
 * An in-memory database carrying the whole schema, built from the same
 * TABLE_STATEMENTS the Worker runs at startup. Close it when the test ends.
 */
export function createSchemaDb(): SqliteDb {
  const { DatabaseSync } = load();
  const db = new DatabaseSync(":memory:");
  for (const statement of TABLE_STATEMENTS) db.exec(statement);
  return db;
}

/** The SQL of every statement the handler prepared, in call order. */
export function preparedSql(db: { prepare: unknown }): string[] {
  return (db.prepare as { mock: { calls: unknown[][] } }).mock.calls
    .map((call) => String(call[0]));
}
