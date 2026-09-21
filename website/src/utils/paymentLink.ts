/** The public subs-payment page for one player. */
export function buildPaymentLink(origin: string, clubSlug: string, fanId: string): string {
  return `${origin}/${clubSlug}/payments/SUBS/${encodeURIComponent(fanId)}`;
}
