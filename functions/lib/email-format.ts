/**
 * Shared outbound mail header formatting — provider-agnostic.
 */

/** Strip structural characters so an address cannot smuggle a second header. */
export function sanitizeAddress(address: string): string {
  // eslint-disable-next-line no-control-regex
  return address.replace(/[\r\n<>,;"\\\s\u0000-\u001F\u007F]/g, "");
}

export function sanitizeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  return subject.replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim();
}

export function formatFrom(name: string | undefined, address: string): string {
  const cleanAddress = sanitizeAddress(address);
  // eslint-disable-next-line no-control-regex
  const cleanName = (name ?? "").replace(/["\\\r\n\u0000-\u001F\u007F]/g, "").trim();
  return cleanName ? `${JSON.stringify(cleanName)} <${cleanAddress}>` : cleanAddress;
}
