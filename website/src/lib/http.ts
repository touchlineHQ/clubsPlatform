/**
 * A non-ok API response, thrown so that captureError can say which one it was.
 *
 * A bare `new Error('Failed to load …')` reaches error tracking with no status
 * and no path, so a 401, a 403 and a 500 all look the same — and Pages
 * Functions keep no logs to fall back on.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly path: string,
    /** The API's own `{ error }` message, when the body carried one. */
    readonly serverError: string | undefined,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Build an HttpError from a non-ok response, reading the API's `{ error }` if it sent one. */
export async function httpError(message: string, res: Response, path: string): Promise<HttpError> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  const serverError = typeof body?.error === 'string' ? body.error.slice(0, 200) : undefined;
  return new HttpError(message, res.status, path, serverError);
}
