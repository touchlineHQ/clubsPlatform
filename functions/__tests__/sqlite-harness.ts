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
 * `node:sqlite` is available without a flag from Node 22.13, which is what
 * package.json requires and CI's Node 22 installs. This costs no dependency.
 * It is reached through createRequire because Vite tries to resolve
 * `node:sqlite` as a bare specifier and fails.
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
      "node:sqlite is available without a flag from Node 22.13; earlier Node 22.x "
        + `releases require --experimental-sqlite. Got ${process.version}. (${String(err)})`,
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

/**
 * A D1-shaped facade over a real SQLite database.
 *
 * Lets a handler run end to end against actual SQL instead of canned rows, so
 * a test can assert what a query *returns* rather than how it is spelled. Use
 * it for anything whose correctness lives in the SQL: paging boundaries,
 * filters, aggregation.
 *
 * It implements the slice of D1 these handlers use — prepare/bind/all/first/run
 * and batch — not D1 itself. Its limits are SQLite's, not D1's: the
 * 100-parameter bind cap and the subrequest budget are invisible here, so keep
 * asserting those against the generated SQL.
 */
export function d1Over(db: SqliteDb): {
  prepare(sql: string): unknown;
  batch(statements: unknown[]): Promise<{ results: unknown[] }[]>;
} {
  const run = (sql: string, params: unknown[]) => {
    const statement = db.prepare(sql);
    return {
      all: async () => ({ results: statement.all(...params), success: true, meta: {} }),
      first: async () => (statement.all(...params)[0] as unknown) ?? null,
      run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
      // Carried so batch() can execute a statement someone already bound.
      __sql: sql,
      __params: params,
    };
  };

  return {
    prepare(sql: string) {
      return {
        ...run(sql, []),
        bind: (...params: unknown[]) => run(sql, params),
      };
    },
    async batch(statements: unknown[]) {
      return statements.map((s) => {
        const bound = s as { __sql: string; __params: unknown[] };
        return { results: db.prepare(bound.__sql).all(...bound.__params), success: true, meta: {} };
      });
    },
  };
}
