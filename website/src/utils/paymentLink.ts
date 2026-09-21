/**
 * The public subs-payment page for one player.
 *
 * Shared by the registrations export and the status report, which both put the
 * link in a spreadsheet cell for an admin to send on.
 */
export function buildPaymentLink(origin: string, clubSlug: string, fanId: string): string {
  return `${origin}/${clubSlug}/payments/SUBS/${encodeURIComponent(fanId)}`;
}
