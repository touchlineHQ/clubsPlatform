/**
 * The one place `cloudflare:sockets` is imported.
 *
 * It is a workerd built-in with no Node equivalent, so importing it anywhere
 * that a test might load would break the suite. Keeping it behind this module
 * means `smtp.ts` can be exercised against a scripted fake socket by mocking a
 * single, obvious seam.
 */
export { connect } from "cloudflare:sockets";
