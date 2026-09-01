import { createAuth } from "./auth";
import { isMultiClubMode, isPitchBookingsEnabled } from "./env-flags";

// Re-exported so the many call sites that reach for them alongside `json` and
// `requireAdmin` keep one import. The implementations live below `auth.ts` in
// the import graph — see lib/env-flags.ts.
export { isMultiClubMode, isPitchBookingsEnabled };

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
  EMAIL_API_KEY?: string; // transactional email provider key — Cloudflare secret
  EMAIL_FROM?: string;
  EMAIL_API_BASE?: string;
}

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
) {
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
) {
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
export async function requireAuth(context: EventContext<Env, string, unknown>) {
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
