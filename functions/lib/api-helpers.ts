import { createAuth } from "./auth";

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(req: Request | string): Promise<Response> };
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  MULTI_CLUB?: string;
  PITCH_BOOKINGS?: string;
  GC_ENVIRONMENT?: string;
  SECRETS_ENCRYPTION_KEY: string;
  SECRETS_TRANSPORT_PRIVATE_KEY: string; // base64 PKCS8 DER — Cloudflare secret
  SECRETS_TRANSPORT_PUBLIC_KEY: string; // base64 SPKI DER — plain env var
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

/**
 * The session better-auth hands back once a request is authenticated.
 *
 * Derived from createAuth rather than written out by hand so it keeps tracking
 * better-auth's own shape across upgrades.
 */
type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>
>;

/**
 * What an auth guard returns: either a ready-to-send error Response, or the
 * success payload the caller asked for.
 *
 * This union has to be written out rather than inferred. Left to inference,
 * TypeScript normalises the two return shapes into
 * `{ error: Response; session?: undefined } | { session: Session; error?: undefined }`
 * — every arm carries an `error` key, so `if ("error" in result)` stops
 * discriminating, `result.error` widens to `Response | undefined`, and every
 * handler that returns it infers `Promise<Response | undefined>` and no longer
 * satisfies `PagesFunction`. That was 54 of the 56 errors the first typecheck
 * of functions/ reported, across 30 route files.
 */
export type Guard<T> = { error: Response } | T;

/** Create a JSON Response with the appropriate Content-Type header. */
export function json(res: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(res), {
    ...(init ?? {}),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Return the current timestamp in milliseconds. */
export function nowMs(): number {
  return Date.now();
}

/** Generate a random ID with the given prefix. */
export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Returns true when MULTI_CLUB env var is set to a truthy value. */
export function isMultiClubMode(env: Env): boolean {
  const v = env.MULTI_CLUB;
  return !!(v && v !== "0" && v !== "false");
}

/** Returns true when PITCH_BOOKINGS env var is set to a truthy value. */
export function isPitchBookingsEnabled(env: Env): boolean {
  const v = env.PITCH_BOOKINGS;
  return !!(v && v !== "0" && v !== "false");
}

/** Extract the club slug sent by the frontend via X-Club-Slug header. */
export function getClubSlug(request: Request): string | null {
  return request.headers.get("X-Club-Slug") || null;
}

/**
 * Verify the request has admin authentication and return the session.
 * Returns an error response for unauthenticated or non-admin users.
 * In multi-club mode, also enforces that the admin's club matches the request club.
 */
export async function requireAdmin(
  context: EventContext<Env, string, unknown>,
): Promise<Guard<{ session: Session }>> {
  const baseURL =
    context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });
  if (!session) {
    return {
      error: json({ error: "Not authenticated" }, { status: 401 }),
    } as const;
  }
  const user = session.user as Record<string, unknown>;
  const role = user.role as string;
  if (role !== "admin") {
    return {
      error: json({ error: "Admin access required" }, { status: 403 }),
    } as const;
  }

  // In multi-club mode, verify the admin's club matches the request's club.
  // A user with clubSlug = null is a platform superadmin and may access any club.
  if (isMultiClubMode(context.env)) {
    const userClubSlug = (user.clubSlug as string | null) ?? null;
    const requestClubSlug = getClubSlug(context.request);
    if (userClubSlug !== null && userClubSlug !== requestClubSlug) {
      return {
        error: json({ error: "Access denied: club mismatch" }, { status: 403 }),
      } as const;
    }
  }

  return { session } as const;
}

/**
 * Verify the request has manager or admin authentication and return the session.
 * Returns an error response for unauthenticated or insufficient-privilege users.
 * In multi-club mode, also enforces that the user's club matches the request club.
 */
export async function requireManagerOrAdmin(
  context: EventContext<Env, string, unknown>,
): Promise<Guard<{ session: Session; role: string }>> {
  const baseURL =
    context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });
  if (!session) {
    return {
      error: json({ error: "Not authenticated" }, { status: 401 }),
    } as const;
  }
  const user = session.user as Record<string, unknown>;
  const role = user.role as string;
  if (role !== "admin" && role !== "manager") {
    return {
      error: json(
        { error: "Manager or admin access required" },
        { status: 403 },
      ),
    } as const;
  }

  if (isMultiClubMode(context.env)) {
    const userClubSlug = (user.clubSlug as string | null) ?? null;
    const requestClubSlug = getClubSlug(context.request);
    if (userClubSlug !== null && userClubSlug !== requestClubSlug) {
      return {
        error: json({ error: "Access denied: club mismatch" }, { status: 403 }),
      } as const;
    }
  }

  return { session, role } as const;
}

/** Verify the request has valid authentication and return the session. Returns an error response for unauthenticated users. */
export async function requireAuth(
  context: EventContext<Env, string, unknown>,
): Promise<Guard<{ session: Session; role: string }>> {
  const baseURL =
    context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });
  if (!session) {
    return {
      error: json({ error: "Not authenticated" }, { status: 401 }),
    } as const;
  }
  return {
    session,
    role: (session.user as Record<string, unknown>).role as string,
  } as const;
}
