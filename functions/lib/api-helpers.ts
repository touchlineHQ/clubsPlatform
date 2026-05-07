import { createAuth } from "./auth";

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(req: Request | string): Promise<Response> };
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  MULTI_CLUB?: string;
  PITCH_BOOKINGS?: string;
  SECRETS_ENCRYPTION_KEY: string;
}

export function json(res: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(res), {
    ...(init ?? {}),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function nowMs(): number {
  return Date.now();
}

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

export async function requireAdmin(context: EventContext<Env, string, unknown>) {
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({ headers: context.request.headers });
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

export async function requireManagerOrAdmin(context: EventContext<Env, string, unknown>) {
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({ headers: context.request.headers });
  if (!session) {
    return {
      error: json({ error: "Not authenticated" }, { status: 401 }),
    } as const;
  }
  const user = session.user as Record<string, unknown>;
  const role = user.role as string;
  if (role !== "admin" && role !== "manager") {
    return {
      error: json({ error: "Manager or admin access required" }, { status: 403 }),
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

export async function requireAuth(context: EventContext<Env, string, unknown>) {
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  const session = await auth.api.getSession({ headers: context.request.headers });
  if (!session) {
    return {
      error: json({ error: "Not authenticated" }, { status: 401 }),
    } as const;
  }
  return { session, role: (session.user as Record<string, unknown>).role as string } as const;
}
