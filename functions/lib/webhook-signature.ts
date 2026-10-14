/**
 * Verify a Svix-signed webhook (Resend signs its webhooks with Svix).
 *
 * Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256
 * with the base64 secret after the `whsec_` prefix. `svix-signature` holds one
 * or more space-separated `v1,<base64>` entries. Timestamps outside the
 * tolerance are rejected so a captured request cannot be replayed later.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvixPayload(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const keyBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToBase64(new Uint8Array(sig));
}

export async function verifySvixSignature(
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signatures = headers.get("svix-signature") ?? "";
  if (!id || !/^\d+$/.test(timestamp) || !signatures) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  let expected: string;
  try {
    expected = await signSvixPayload(secret, id, timestamp, body);
  } catch {
    return false;
  }
  return signatures
    .split(" ")
    .map((entry) => entry.split(","))
    .some(([version, sig]) => version === "v1" && typeof sig === "string" && timingSafeEqual(sig, expected));
}
