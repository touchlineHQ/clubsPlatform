import { json } from "../lib/api-helpers";
import { currentMarketingConsentPolicy } from "../lib/consent";

/**
 * Public marketing-consent wording so forms hash the same copy the server stores.
 */
export const onRequestGet: PagesFunction = async () => {
  return json(await currentMarketingConsentPolicy());
};
