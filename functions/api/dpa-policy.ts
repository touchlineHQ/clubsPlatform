import { json } from "../lib/api-helpers";
import { currentDpaPolicy } from "../lib/dpa";

/**
 * Public DPA wording for the club registration form.
 */
export const onRequestGet: PagesFunction = async () => {
  return json(await currentDpaPolicy());
};
