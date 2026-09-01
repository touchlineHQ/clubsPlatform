/**
 * Deployment feature flags, read straight from the environment.
 *
 * These live apart from `api-helpers` so that modules below it in the import
 * graph — `lib/auth.ts` and the mailer it pulls in — can read a flag without
 * creating a cycle through `api-helpers → auth → …`.
 */

/** Returns true when MULTI_CLUB env var is set to a truthy value. */
export function isMultiClubMode(env: { MULTI_CLUB?: string }): boolean {
  const v = env.MULTI_CLUB;
  return !!(v && v !== "0" && v !== "false");
}

/** Returns true when PITCH_BOOKINGS env var is set to a truthy value. */
export function isPitchBookingsEnabled(env: { PITCH_BOOKINGS?: string }): boolean {
  const v = env.PITCH_BOOKINGS;
  return !!(v && v !== "0" && v !== "false");
}
