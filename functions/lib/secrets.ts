import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "./api-helpers";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(env: Env): Promise<CryptoKey> {
  const raw = hexToBytes(env.SECRETS_ENCRYPTION_KEY);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(
  env: Env,
  plaintext: string,
): Promise<{ encryptedValue: string; iv: string }> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    encryptedValue: bytesToBase64url(new Uint8Array(ciphertext)),
    iv: bytesToBase64url(iv),
  };
}

export async function decryptSecret(
  env: Env,
  encryptedValue: string,
  iv: string,
): Promise<string> {
  const key = await importKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlToBytes(iv) },
    key,
    base64urlToBytes(encryptedValue),
  );
  return new TextDecoder().decode(plaintext);
}

/** Retrieve and decrypt a single secret for backend use only. Returns null if not found. */
export async function getSecret(
  db: D1Database,
  env: Env,
  clubSlug: string | null,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT encryptedValue, iv FROM "club_secret"
       WHERE COALESCE(clubSlug,'') = COALESCE(?,'') AND key = ?`,
    )
    .bind(clubSlug, key)
    .first<{ encryptedValue: string; iv: string }>();
  if (!row) return null;
  return decryptSecret(env, row.encryptedValue, row.iv);
}
