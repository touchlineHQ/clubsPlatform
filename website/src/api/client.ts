import type { paths } from "./schema";

type HttpMethod = "get" | "post" | "patch" | "delete";

type ContentType = "application/json";

type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never;
}[keyof paths];

type Op<P extends keyof paths, M extends HttpMethod> = paths[P][M];
type Params<P extends keyof paths, M extends HttpMethod> = Op<P, M> extends {
  parameters?: infer R;
}
  ? R
  : never;

type Query<P extends keyof paths, M extends HttpMethod> = Params<P, M> extends {
  query?: infer Q;
}
  ? Q
  : never;

type ReqBody<P extends keyof paths, M extends HttpMethod> = Op<P, M> extends {
  requestBody?: {
    content?: Record<ContentType, infer B>;
  };
}
  ? B
  : never;

type Res<P extends keyof paths, M extends HttpMethod> = Op<P, M> extends {
  responses: infer R;
}
  ? R
  : never;

type JsonResponse<T> = T extends Record<string | number, unknown>
  ? {
      [K in keyof T]: K extends 200 | 201 ? T[K] : never;
    }[keyof T] extends infer R
    ? R extends { content: Record<ContentType, infer C> }
      ? C
      : unknown
    : unknown
  : unknown;

/** Append query parameters to a URL. */
function withQuery(url: string, query: Record<string, unknown> | undefined) {
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/**
 * Type-safe API fetch helper that validates requests against the OpenAPI schema.
 * Automatically includes credentials and parses JSON responses.
 */
export async function apiFetch<P extends PathsWithMethod<M>, M extends HttpMethod>(
  method: M,
  path: P,
  opts?: {
    query?: Query<P, M> extends Record<string, unknown> ? Query<P, M> : never;
    body?: ReqBody<P, M>;
    headers?: Record<string, string>;
  }
): Promise<JsonResponse<Res<P, M>>> {
  const url = withQuery(String(path), (opts?.query as Record<string, unknown> | undefined) ?? undefined);
  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts?.headers ?? {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const err =
      typeof data === "object" && data && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : `Request failed (${res.status})`;
    throw new Error(err);
  }

  return data as JsonResponse<Res<P, M>>;
}

