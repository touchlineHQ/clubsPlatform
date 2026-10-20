interface Env {
  DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
}

/**
 * Public liveness/readiness probe.
 *
 * Deliberately minimal: it reports whether D1 answers a read-only query and
 * whether auth is configured, nothing else. No secret lengths, token
 * presence, table names or migration history, and no writes or DDL on GET
 * (#261). Raw errors are logged server-side only, never returned (#260).
 */
export type HealthStatus = "ok" | "degraded";
export type D1Check = "ok" | "unbound" | "error";

export interface HealthBody {
  status: HealthStatus;
  checks: {
    d1: D1Check;
    auth_configured: boolean;
  };
}

async function checkD1(db: D1Database | undefined): Promise<D1Check> {
  if (!db) return "unbound";
  try {
    await db.prepare("SELECT 1").first();
    return "ok";
  } catch (e) {
    console.error("[health] d1 check failed", e);
    return "error";
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const d1 = await checkD1(context.env.DB);
  const body: HealthBody = {
    status: d1 === "ok" ? "ok" : "degraded",
    checks: {
      d1,
      auth_configured: !!context.env.BETTER_AUTH_SECRET,
    },
  };

  return new Response(JSON.stringify(body), {
    status: body.status === "ok" ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
