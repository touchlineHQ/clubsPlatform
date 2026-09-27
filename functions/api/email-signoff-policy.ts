import { json } from "../lib/api-helpers";
import { currentPolicyPayload } from "../lib/club-email-signoff";

/**
 * Public policy wording for the club email sign-off liabilities.
 *
 * Unauthenticated so the landing-page registration form can render the same
 * copy the server will hash. No club state — that lives on the admin endpoint.
 */
export const onRequestGet: PagesFunction = async () => {
  return json(await currentPolicyPayload());
};
