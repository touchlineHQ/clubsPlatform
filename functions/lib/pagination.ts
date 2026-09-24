/**
 * Keyset pagination, for every paginated read in this repository.
 *
 * Pure on purpose: no D1, no Response, no imports from the rest of functions/.
 * Errors are returned rather than thrown so the route decides the status code.
 *
 * **Cursor, not offset**, and not primarily for scan cost. An admin sits on the
 * registrations page while an import commits and while merges are applied;
 * `OFFSET` under a shifting result set silently skips and duplicates rows, and
 * that is the table a treasurer uses to decide who to chase.
 */

export type SortDir = "asc" | "desc";

/**
 * One whitelisted sort key.
 *
 * `expr` **must be total** — it must never evaluate to NULL. The keyset
 * predicate compares with `>` / `<`, and a NULL operand makes the whole
 * comparison NULL, so the page comes back *empty* rather than merely
 * mis-ordered. {@link totalTextKey} is how a nullable column is made safe.
 *
 * `bare` marks an expression that is a plain column. ORDER BY then repeats it
 * instead of going through the cursor alias, which is what keeps an index able
 * to satisfy the ordering.
 */
export interface SortSpec {
  readonly expr: string;
  readonly collate?: "NOCASE" | "BINARY" | "RTRIM";
  readonly bare?: boolean;
}

export type SortWhitelist = Readonly<Record<string, SortSpec>>;

/**
 * Collapses NULL and '' into one sort key that orders last ascending.
 *
 * Two jobs at once. It makes a nullable expression total, without which the
 * keyset predicate empties the page. And the `'0'`/`'1'` prefix reproduces the
 * client's `compareValues`, which sorts an empty value last — SQLite's own
 * default does the opposite, putting NULLs first ascending.
 *
 * A single scalar rather than a leading `CASE … THEN 1 ELSE 0 END` term,
 * because a two-term ORDER BY needs a three-level keyset predicate and a cursor
 * carrying two values. This is byte-identical in ordering and fits the one
 * value the cursor already has room for.
 */
export function totalTextKey(expr: string): string {
  return `(CASE WHEN COALESCE(${expr}, '') = '' THEN '1' ELSE '0' END || COALESCE(${expr}, ''))`;
}

/** The opaque page position. `v` is always bound, never interpolated. */
export interface Cursor {
  s: string;
  d: SortDir;
  v: string;
  id: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageRequestInput {
  sort?: string | null;
  dir?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
}

export interface PageRequest {
  sort: string;
  dir: SortDir;
  /** Clamped to LIMIT_MIN..LIMIT_MAX. */
  limit: number;
  cursor: Cursor | null;
}

export const LIMIT_MIN = 1;
export const LIMIT_MAX = 200;
export const LIMIT_DEFAULT = 50;

/** base64url — '+', '/' and '=' do not survive a query string unescaped. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Encodes a cursor.
 *
 * Through TextEncoder rather than `btoa` directly: `v` can be a team name with
 * non-ASCII characters, and `btoa` throws above code point 255.
 */
export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

/**
 * Decodes a cursor, returning null for anything malformed.
 *
 * The payload is attacker-controlled, so every field is type-checked. It needs
 * no signing — it carries no authority, club scope comes from the session and
 * `X-Club-Slug` — and a tampered `v` is bound rather than interpolated, so the
 * blast radius is a wrong page.
 */
export function decodeCursor(raw: string): Cursor | null {
  const bytes = fromBase64Url(raw);
  if (!bytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { s, d, v, id } = parsed as Record<string, unknown>;
  if (typeof s !== "string" || typeof v !== "string" || typeof id !== "string") return null;
  if (d !== "asc" && d !== "desc") return null;

  return { s, d, v, id };
}

function clampLimit(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(n)));
}

/**
 * Validates a page request against a sort whitelist.
 *
 * An unknown sort key is a 400 and is never interpolated into SQL. `limit` is
 * clamped rather than rejected — an out-of-range limit is a caller being
 * optimistic, not an error worth failing a page load over.
 *
 * A cursor whose `s`/`d` disagree with the request is **rejected**, not
 * silently honoured: minted under one sort and applied to another, it would
 * skip an arbitrary slice of the set with nothing on screen to say so.
 */
export function parsePageRequest(
  input: PageRequestInput,
  whitelist: SortWhitelist,
  defaults: { sort: string; dir?: SortDir; limit?: number },
): Parsed<PageRequest> {
  const sort = input.sort ?? defaults.sort;
  if (!Object.prototype.hasOwnProperty.call(whitelist, sort)) {
    return { ok: false, error: "unknown sort key" };
  }

  const rawDir = input.dir ?? defaults.dir ?? "asc";
  if (rawDir !== "asc" && rawDir !== "desc") {
    return { ok: false, error: "invalid sort direction" };
  }

  const limit = input.limit == null ? (defaults.limit ?? LIMIT_DEFAULT) : clampLimit(input.limit);

  let cursor: Cursor | null = null;
  if (input.cursor) {
    cursor = decodeCursor(input.cursor);
    if (!cursor) return { ok: false, error: "malformed cursor" };
    if (cursor.s !== sort) return { ok: false, error: "cursor does not match the requested sort" };
    if (cursor.d !== rawDir) {
      return { ok: false, error: "cursor does not match the requested direction" };
    }
  }

  return { ok: true, value: { sort, dir: rawDir, limit, cursor } };
}

export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

function collated(spec: SortSpec, expr: string): string {
  return spec.collate ? `${expr} COLLATE ${spec.collate}` : expr;
}

/**
 * The keyset predicate, or an empty fragment on page 1.
 *
 * Expanded rather than a row-value comparison `(a, b) > (?, ?)`: row values
 * need SQLite >= 3.15 and D1's version is pinned nowhere in this repo. The
 * expanded form works everywhere and costs one extra binding.
 */
export function buildKeysetPredicate(
  request: PageRequest,
  whitelist: SortWhitelist,
  idExpr: string,
): SqlFragment {
  if (!request.cursor) return { sql: "", bindings: [] };

  const spec = whitelist[request.sort];
  const expr = collated(spec, spec.expr);
  const op = request.dir === "asc" ? ">" : "<";

  return {
    sql: `AND (${expr} ${op} ? OR (${expr} = ? AND ${idExpr} ${op} ?))`,
    bindings: [request.cursor.v, request.cursor.v, request.cursor.id],
  };
}

/**
 * The sort key as a SELECT-list column.
 *
 * Aliased so the server reads the next cursor's value straight off the last
 * row rather than re-deriving it in JS — a second implementation of the sort
 * expression is a second thing to drift.
 */
export function buildCursorColumn(
  request: PageRequest,
  whitelist: SortWhitelist,
  alias = "__cursor",
): string {
  return `${whitelist[request.sort].expr} AS "${alias}"`;
}

/**
 * ORDER BY, always with the id tiebreak appended.
 *
 * The tiebreak follows the sort direction. A fixed `ASC` tiebreak under a
 * `DESC` sort makes the ORDER BY and the keyset predicate disagree about what
 * comes next, and rows fall through the gap between pages.
 *
 * A `bare` spec is repeated rather than referenced by alias so it stays
 * index-eligible; `COLLATE` is spelled out either way rather than assumed to
 * propagate out of the aliased expression.
 */
export function buildOrderBy(
  request: PageRequest,
  whitelist: SortWhitelist,
  opts: { cursorAlias?: string; idAlias: string },
): string {
  const spec = whitelist[request.sort];
  const alias = opts.cursorAlias ?? "__cursor";
  const term = collated(spec, spec.bare ? spec.expr : `"${alias}"`);
  const direction = request.dir === "asc" ? "ASC" : "DESC";

  return `ORDER BY ${term} ${direction}, ${opts.idAlias} ${direction}`;
}

/** One more than asked for, so the caller learns whether a next page exists. */
export function fetchLimit(request: PageRequest): number {
  return request.limit + 1;
}

/**
 * Trims the probe row and mints the next cursor from the last returned row.
 *
 * `key` reads the cursor value off the row itself. Deriving it in JS instead
 * would let the cursor describe a position the SQL would never produce.
 */
export function takePage<T>(
  rows: readonly T[],
  request: PageRequest,
  key: (row: T) => { v: string; id: string },
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > request.limit;
  const items = hasMore ? rows.slice(0, request.limit) : [...rows];
  if (!hasMore || items.length === 0) return { items, nextCursor: null };

  const last = key(items[items.length - 1]);
  return {
    items,
    nextCursor: encodeCursor({ s: request.sort, d: request.dir, v: last.v, id: last.id }),
  };
}
