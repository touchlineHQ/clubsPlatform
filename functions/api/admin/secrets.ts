import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { encryptSecret, decryptTransport } from "../../lib/secrets";

const ALLOWED_KEYS = ["GC_ACCESS_TOKEN", "GC_WEBHOOK_SECRET"] as const;
type AllowedKey = typeof ALLOWED_KEYS[number];

function isAllowedKey(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

/**
 * A platform-wide (null-club) GC_WEBHOOK_SECRET verifies events for clubs that
 * have no secret of their own, and payment events then need a GC_ACCESS_TOKEN
 * from the same scope to look up the payment's mandate (#77). Without the pair
 * those failures would be acknowledged and never recorded, so the platform
 * token must exist before the platform webhook secret, and can't be removed
 * while it is set.
 */
async function hasPlatformSecret(db: D1Database, key: AllowedKey): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS present FROM "club_secret" WHERE clubSlug IS NULL AND key = ?`)
    .bind(key)
    .first<{ present: number }>();
  return !!row;
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
  if (key === "GC_WEBHOOK_SECRET" && !getClubSlug(context.request)
      && !(await hasPlatformSecret(context.env.DB, "GC_ACCESS_TOKEN"))) {
    return json(
      { error: "Set the platform GC_ACCESS_TOKEN first: a platform-wide GC_WEBHOOK_SECRET needs it to look up payments." },
      { status: 400 },
    );
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
  if (key === "GC_ACCESS_TOKEN" && !clubSlug && (await hasPlatformSecret(context.env.DB, "GC_WEBHOOK_SECRET"))) {
    return json(
      { error: "Remove the platform GC_WEBHOOK_SECRET first: it needs the platform GC_ACCESS_TOKEN to look up payments." },
      { status: 409 },
    );
  }

  await context.env.DB
    .prepare(
      `DELETE FROM "club_secret"
       WHERE COALESCE(clubSlug,'') = COALESCE(?,'') AND key = ?`,
    )
    .bind(clubSlug, key)
    .run();

  return json({ ok: true });
};
