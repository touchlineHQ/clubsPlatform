/**
 * Shared outbound mail header formatting — provider-agnostic.
 */

/** Strip structural characters so an address cannot smuggle a second header. */
export function sanitizeAddress(address: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return address.replace(/[\r\n<>,;"\\\s\u0000-\u001F\u007F]/g, "");
}

export function sanitizeSubject(subject: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return subject.replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim();
}

export function formatFrom(name: string | undefined, address: string): string {
  const cleanAddress = sanitizeAddress(address);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const cleanName = (name ?? "").replace(/["\\\r\n\u0000-\u001F\u007F]/g, "").trim();
  return cleanName ? `${JSON.stringify(cleanName)} <${cleanAddress}>` : cleanAddress;
}
