export const SIGNUP_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  passwordMin: 10,
  passwordMax: 128,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupBody = {
  name?: unknown;
  email?: unknown;
  password?: unknown;
};

/**
 * Returns a human-readable error string if the body is invalid, otherwise null.
 * Length caps prevent oversized payloads from reaching the auth handler / DB;
 * the password floor of 10 sits above better-auth's default of 8.
 */
export function validateSignupBody(body: SignupBody): string | null {
  if (!body || typeof body !== 'object') return 'Invalid request body';

  const { email, password, name } = body;

  if (typeof email !== 'string' || !email.trim()) return 'Email is required';
  const trimmedEmail = email.trim();
  if (trimmedEmail.length > SIGNUP_LIMITS.emailMax) return 'Email is too long';
  if (!EMAIL_RE.test(trimmedEmail)) return 'Email is invalid';

  if (typeof password !== 'string') return 'Password is required';
  if (password.length < SIGNUP_LIMITS.passwordMin) {
    return `Password must be at least ${SIGNUP_LIMITS.passwordMin} characters`;
  }
  if (password.length > SIGNUP_LIMITS.passwordMax) return 'Password is too long';

  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') return 'Name must be a string';
    if (name.length > SIGNUP_LIMITS.nameMax) return 'Name is too long';
  }

  return null;
}

/** Check if a request is a sign-up request based on method and pathname. */
export function isSignupRequest(method: string, pathname: string): boolean {
  return method === 'POST' && /\/api\/auth\/sign-up(\/|$)/.test(pathname);
}
