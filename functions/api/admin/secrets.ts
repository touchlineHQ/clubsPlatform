import { type Env, json, requireAdmin, getClubSlug, randomId, nowMs } from "../../lib/api-helpers";
import { encryptSecret, decryptTransport } from "../../lib/secrets";

const ALLOWED_KEYS = ["GC_ACCESS_TOKEN", "GC_WEBHOOK_SECRET"] as const;
type AllowedKey = typeof ALLOWED_KEYS[number];

function isAllowedKey(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

/** Same-scope (club or platform) row exists for `key`; binds one clubSlug. */
const sameScopeExistsSql = (key: AllowedKey) =>
  `EXISTS (SELECT 1 FROM "club_secret" s2 WHERE COALESCE(s2.clubSlug,'') = COALESCE(?,'') AND s2.key = '${key}')`;

/**
 * GoCardless webhook secrets verify events per scope (a club, or platform-wide
 * for clubs with no secret of their own), and payment events then need a
 * GC_ACCESS_TOKEN from the same scope to look up the payment's mandate (#77).
 * Without the pair those failures would be acknowledged and never recorded, so
 * in every scope the token must exist before the webhook secret, and can't be
 * removed while it is set.
 */
async function hasScopeSecret(db: D1Database, clubSlug: string | null, key: AllowedKey): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS present FROM "club_secret" WHERE COALESCE(clubSlug,'') = COALESCE(?,'') AND key = ?`)
    .bind(clubSlug, key)
    .first<{ present: number }>();
  return !!row;
}

function scopeLabel(clubSlug: string | null): string {
  return clubSlug ? "this club's" : "the platform";
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

  // The pair guard lives in the write itself, so a concurrent DELETE of the
  // same-scope GC_ACCESS_TOKEN can't slip between a check and this insert.
  const write = await context.env.DB
    .prepare(
      `INSERT INTO "club_secret" (id, clubSlug, key, encryptedValue, iv, createdAt, updatedAt)
       SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE ? <> 'GC_WEBHOOK_SECRET' OR ${sameScopeExistsSql("GC_ACCESS_TOKEN")}
       ON CONFLICT(COALESCE(clubSlug,''), key) DO UPDATE SET
         encryptedValue = excluded.encryptedValue,
         iv             = excluded.iv,
         updatedAt      = excluded.updatedAt`,
    )
    .bind(randomId("secret"), clubSlug, key, encryptedValue, iv, now, now, key, clubSlug)
    .run();
  if (!write.meta?.changes) {
    return json(
      { error: `Set ${scopeLabel(clubSlug)} GC_ACCESS_TOKEN first: a GC_WEBHOOK_SECRET needs the token from the same scope to look up payments.` },
      { status: 400 },
    );
  }

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
  // Guarded in the same statement as the POST guard above, so the pair can't
  // be split by concurrent requests.
  const removed = await context.env.DB
    .prepare(
      `DELETE FROM "club_secret"
       WHERE COALESCE(clubSlug,'') = COALESCE(?,'') AND key = ?
         AND NOT (key = 'GC_ACCESS_TOKEN' AND ${sameScopeExistsSql("GC_WEBHOOK_SECRET")})`,
    )
    .bind(clubSlug, key, clubSlug)
    .run();
  if (!removed.meta?.changes && key === "GC_ACCESS_TOKEN"
      && (await hasScopeSecret(context.env.DB, clubSlug, "GC_WEBHOOK_SECRET"))) {
    return json(
      { error: `Remove ${scopeLabel(clubSlug)} GC_WEBHOOK_SECRET first: it needs the GC_ACCESS_TOKEN from the same scope to look up payments.` },
      { status: 409 },
    );
  }

  return json({ ok: true });
};
