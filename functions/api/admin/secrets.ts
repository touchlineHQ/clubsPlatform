import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { encryptSecret, decryptTransport } from "../../lib/secrets";

const ALLOWED_KEYS = ["GC_ACCESS_TOKEN"] as const;
type AllowedKey = typeof ALLOWED_KEYS[number];

function isAllowedKey(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

interface SecretRow {
  id: string;
  key: string;
  updatedAt: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT id, key, updatedAt FROM "club_secret"
       WHERE COALESCE(clubSlug,'') = COALESCE(?,'')
       ORDER BY key ASC`,
    )
    .bind(clubSlug)
    .all<SecretRow>();

  return json({ secrets: rows.results, publicKey: context.env.SECRETS_TRANSPORT_PUBLIC_KEY || null });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  if (!context.env.SECRETS_ENCRYPTION_KEY) {
    return json({ error: "SECRETS_ENCRYPTION_KEY is not configured" }, { status: 500 });
  }

  const body = await context.request.json() as { key?: string; encryptedValue?: string };
  const { key, encryptedValue: transportCiphertext } = body;

  if (!key || !isAllowedKey(key)) {
    return json({ error: `key must be one of: ${ALLOWED_KEYS.join(", ")}` }, { status: 400 });
  }
  if (!transportCiphertext) {
    return json({ error: "encryptedValue is required" }, { status: 400 });
  }
  if (!context.env.SECRETS_TRANSPORT_PRIVATE_KEY) {
    return json({ error: "Transport key not configured" }, { status: 500 });
  }

  const clubSlug = getClubSlug(context.request);
  const plaintext = await decryptTransport(context.env, transportCiphertext);
  const { encryptedValue, iv } = await encryptSecret(context.env, plaintext);
  const now = nowMs();

  await context.env.DB
    .prepare(
      `INSERT INTO "club_secret" (id, clubSlug, key, encryptedValue, iv, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(COALESCE(clubSlug,''), key) DO UPDATE SET
         encryptedValue = excluded.encryptedValue,
         iv             = excluded.iv,
         updatedAt      = excluded.updatedAt`,
    )
    .bind(randomId("secret"), clubSlug, key, encryptedValue, iv, now, now)
    .run();

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const key = new URL(context.request.url).searchParams.get("key");
  if (!key || !isAllowedKey(key)) {
    return json({ error: `key must be one of: ${ALLOWED_KEYS.join(", ")}` }, { status: 400 });
  }

  const clubSlug = getClubSlug(context.request);

  await context.env.DB
    .prepare(
      `DELETE FROM "club_secret"
       WHERE COALESCE(clubSlug,'') = COALESCE(?,'') AND key = ?`,
    )
    .bind(clubSlug, key)
    .run();

  return json({ ok: true });
};
