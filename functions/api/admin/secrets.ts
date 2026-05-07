import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { encryptSecret } from "../../lib/secrets";

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

  return json({ secrets: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  if (!context.env.SECRETS_ENCRYPTION_KEY) {
    return json({ error: "SECRETS_ENCRYPTION_KEY is not configured" }, { status: 500 });
  }

  const body = await context.request.json() as { key?: string; value?: string };
  const { key, value } = body;

  if (!key || !isAllowedKey(key)) {
    return json({ error: `key must be one of: ${ALLOWED_KEYS.join(", ")}` }, { status: 400 });
  }
  if (!value || value.trim() === "") {
    return json({ error: "value is required" }, { status: 400 });
  }

  const clubSlug = getClubSlug(context.request);
  const { encryptedValue, iv } = await encryptSecret(context.env, value);
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
