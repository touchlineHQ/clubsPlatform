import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import {
  currentOperationalConsentPolicy,
  hashToken,
  latestConsentRecord,
  randomTokenHex,
} from "./consent";
import { purgePlayerContact } from "./contact-purge";
import type { EmailPurpose } from "./send-guard";

/**
 * One-click unsubscribe (#135).
 *
 * Every operational / marketing send mints one token per recipient. The URL
 * carries only the token; the database holds only its SHA-256, so a leaked
 * table cannot be turned into working links and a link cannot be guessed or
 * enumerated (256 bits of randomness, no ids in the URL).
 *
 * Withdrawals are scoped to the club that sent the mail (#128: the club is
 * the sender and controller) and take effect immediately — the send guard
 * reads the same columns on the next send.
 */

/** A token opens every action for this long; after that it can still withdraw. */
export const UNSUBSCRIBE_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * After first use the link stays fully usable for this long, so a parent who
 * stops marketing can go on to remove the address in the same visit. After
 * that it is spent: it can withdraw (harmless, idempotent) but not purge.
 */
export const UNSUBSCRIBE_SESSION_GRACE_MS = 60 * 60 * 1000;

export type WithdrawalScope = "marketing" | "all";
export type UnsubscribeAction = WithdrawalScope | "purge";
export type WithdrawalSource = "link" | "one_click" | "complaint";

export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Mint and store one token for one recipient of one send. Returns the plaintext once. */
export async function mintUnsubscribeToken(
  db: D1Database,
  {
    clubSlug,
    contactId,
    purpose,
    batchId,
    now = nowMs(),
  }: {
    clubSlug: string;
    contactId: string;
    purpose: EmailPurpose;
    batchId: string | null;
    now?: number;
  },
): Promise<string> {
  const token = randomTokenHex();
  await db
    .prepare(
      `INSERT INTO "unsubscribe_token"
         (tokenHash, clubSlug, contactId, purpose, batchId, createdAt, expiresAt, usedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(await hashToken(token), clubSlug, contactId, purpose, batchId, now, now + UNSUBSCRIBE_TOKEN_TTL_MS)
    .run();
  return token;
}

export type ResolvedUnsubscribe = {
  tokenHash: string;
  clubSlug: string;
  clubName: string;
  contactId: string;
  purpose: EmailPurpose;
  batchId: string | null;
  /** Unexpired and unused (or first used within the grace window): purge is allowed. */
  fresh: boolean;
  /** null once the contact has been purged. */
  contact: {
    state: string;
    operationalOptIn: number;
    marketingOptIn: number;
  } | null;
};

type ResolvedRow = {
  tokenHash: string;
  clubSlug: string;
  contactId: string;
  purpose: EmailPurpose;
  batchId: string | null;
  expiresAt: number;
  usedAt: number | null;
  clubName: string | null;
  state: string | null;
  operationalOptIn: number | null;
  marketingOptIn: number | null;
};

/** One query: token → club + current contact state. null when the token is unknown. */
export async function resolveUnsubscribeToken(
  db: D1Database,
  token: string,
  now = nowMs(),
): Promise<ResolvedUnsubscribe | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT t.tokenHash, t.clubSlug, t.contactId, t.purpose, t.batchId,
              t.expiresAt, t.usedAt, cc.name AS clubName,
              pc.state, pc.operationalOptIn, pc.marketingOptIn
         FROM "unsubscribe_token" t
         LEFT JOIN "player_contact" pc ON pc.id = t.contactId AND pc.clubSlug = t.clubSlug
         LEFT JOIN "club_config" cc ON cc.slug = t.clubSlug
        WHERE t.tokenHash = ?`,
    )
    .bind(await hashToken(token))
    .first<ResolvedRow>();
  if (!row) return null;
  return {
    tokenHash: row.tokenHash,
    clubSlug: row.clubSlug,
    clubName: row.clubName?.trim() || "Your club",
    contactId: row.contactId,
    purpose: row.purpose,
    batchId: row.batchId,
    fresh: row.expiresAt > now
      && (row.usedAt === null || now - row.usedAt < UNSUBSCRIBE_SESSION_GRACE_MS),
    contact: row.state === null
      ? null
      : {
          state: row.state,
          operationalOptIn: Number(row.operationalOptIn ?? 0),
          marketingOptIn: Number(row.marketingOptIn ?? 0),
        },
  };
}

function auditStatement(
  db: D1Database,
  row: {
    clubSlug: string;
    contactId: string;
    scope: WithdrawalScope | "purge" | "bounce";
    source: WithdrawalSource | "bounce";
    purpose: EmailPurpose | null;
    batchId: string | null;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO "contact_withdrawal"
         (id, clubSlug, contactId, scope, source, purpose, batchId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(randomId("withdraw"), row.clubSlug, row.contactId, row.scope, row.source, row.purpose, row.batchId, row.now);
}

/**
 * Withdraw marketing, or all club mail, for one contact at one club.
 * Idempotent: repeating it only adds an audit row. Never re-enables anything.
 */
export async function withdrawContact(
  db: D1Database,
  {
    clubSlug,
    contactId,
    scope,
    source,
    purpose,
    batchId,
    ipAddress,
    now = nowMs(),
  }: {
    clubSlug: string;
    contactId: string;
    scope: WithdrawalScope;
    source: WithdrawalSource;
    purpose: EmailPurpose | null;
    batchId: string | null;
    ipAddress: string | null;
    now?: number;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  // consent_record is the authority for marketing (send guard reads it), so
  // append a withdrawn row whenever the latest one is still granted.
  const latest = await latestConsentRecord(db, {
    clubSlug,
    subjectType: "player_contact",
    subjectId: contactId,
  });
  if (latest?.state === "granted") {
    statements.push(
      db
        .prepare(
          `INSERT INTO "consent_record"
             (id, clubSlug, subjectType, subjectId, purpose, channel, state,
              recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
           VALUES (?, ?, 'player_contact', ?, 'marketing', 'email', 'withdrawn',
                   ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(randomId("consent"), clubSlug, contactId, now, ipAddress, latest.policyVersion, latest.wordingHash, latest.id),
    );
  }

  if (scope === "marketing") {
    statements.push(
      db
        .prepare(
          `UPDATE "player_contact" SET marketingOptIn = 0, withdrawnAt = ?
            WHERE id = ? AND clubSlug = ?`,
        )
        .bind(now, contactId, clubSlug),
    );
  } else {
    // A bounced address stays bounced; anything else becomes withdrawn so the
    // guard drops it for every purpose, transactional included.
    statements.push(
      db
        .prepare(
          `UPDATE "player_contact"
              SET state = CASE WHEN state = 'bounced' THEN state ELSE 'withdrawn' END,
                  operationalOptIn = 0, marketingOptIn = 0, withdrawnAt = ?
            WHERE id = ? AND clubSlug = ?`,
        )
        .bind(now, contactId, clubSlug),
    );
  }

  if (scope === "all") {
    // Right to object: operational evidence is withdrawn in the same batch as
    // the contact update and audit row, so the three cannot disagree.
    const latestOperational = await latestConsentRecord(db, {
      clubSlug,
      subjectType: "player_contact",
      subjectId: contactId,
      purpose: "operational",
    });
    if (latestOperational?.state !== "withdrawn") {
      const policy = await currentOperationalConsentPolicy();
      statements.push(
        db
          .prepare(
            `INSERT INTO "consent_record"
               (id, clubSlug, subjectType, subjectId, purpose, channel, state,
                recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
             VALUES (?, ?, 'player_contact', ?, 'operational', 'email', 'withdrawn',
                     ?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            randomId("consent"),
            clubSlug,
            contactId,
            now,
            ipAddress,
            latestOperational?.policyVersion ?? policy.policyVersion,
            latestOperational?.wordingHash ?? policy.wordingHash,
            latestOperational?.id ?? null,
          ),
      );
    }
  }

  statements.push(auditStatement(db, { clubSlug, contactId, scope, source, purpose, batchId, now }));
  await db.batch(statements);
}

/** Mark a token spent. Purge needs a fresh token; withdrawals do not. */
export async function markUnsubscribeTokenUsed(
  db: D1Database,
  tokenHash: string,
  now = nowMs(),
): Promise<void> {
  await db
    .prepare(`UPDATE "unsubscribe_token" SET usedAt = COALESCE(usedAt, ?) WHERE tokenHash = ?`)
    .bind(now, tokenHash)
    .run();
}

/**
 * Remove the address entirely (#134's purge), on the parent's instruction
 * from a fresh link. Leaves an address-free audit row and drops the contact's
 * remaining tokens.
 */
export async function purgeFromUnsubscribe(
  db: D1Database,
  resolved: ResolvedUnsubscribe,
  now = nowMs(),
): Promise<boolean> {
  // Audit row and token clean-up commit in the purge's own batch, so a
  // purged contact can never be left without its withdrawal record.
  const purged = await purgePlayerContact(db, {
    clubSlug: resolved.clubSlug,
    contactId: resolved.contactId,
    actor: { actorId: "unsubscribe_link", source: "parent" },
    additionalStatements: [
      auditStatement(db, {
        clubSlug: resolved.clubSlug,
        contactId: resolved.contactId,
        scope: "purge",
        source: "link",
        purpose: resolved.purpose,
        batchId: resolved.batchId,
        now,
      }),
      db
        .prepare(`DELETE FROM "unsubscribe_token" WHERE clubSlug = ? AND contactId = ?`)
        .bind(resolved.clubSlug, resolved.contactId),
    ],
  });
  if (!purged) return false;
  return true;
}

/**
 * Provider bounce / complaint for a message we sent. A hard bounce marks the
 * contact bounced; a spam complaint is treated as withdrawal of all club mail.
 * Returns null (no-op) for unknown messages or a contact already handled.
 */
export async function applyDeliveryFeedback(
  db: D1Database,
  {
    providerMessageId,
    kind,
    now = nowMs(),
  }: {
    providerMessageId: string;
    kind: "bounce" | "complaint";
    now?: number;
  },
): Promise<{ clubSlug: string } | null> {
  const send = await db
    .prepare(
      `SELECT es.clubSlug, es.contactId, es.purpose, es.batchId, pc.state
         FROM "email_send_event" es
         JOIN "player_contact" pc ON pc.id = es.contactId AND pc.clubSlug = es.clubSlug
        WHERE es.providerMessageId = ? AND es.outcome = 'sent'
        LIMIT 1`,
    )
    .bind(providerMessageId)
    .first<{ clubSlug: string; contactId: string; purpose: EmailPurpose; batchId: string; state: string }>();
  if (!send) return null;

  // Idempotent: provider retries and duplicate deliveries change nothing and
  // add no further audit rows once the contact is already in the end state.
  if (kind === "bounce" && send.state === "bounced") return null;
  if (kind === "complaint" && (send.state === "withdrawn" || send.state === "bounced")) return null;

  if (kind === "complaint") {
    await withdrawContact(db, {
      clubSlug: send.clubSlug,
      contactId: send.contactId,
      scope: "all",
      source: "complaint",
      purpose: send.purpose,
      batchId: send.batchId,
      ipAddress: null,
      now,
    });
    return { clubSlug: send.clubSlug };
  }

  await db.batch([
    db
      .prepare(`UPDATE "player_contact" SET state = 'bounced' WHERE id = ? AND clubSlug = ?`)
      .bind(send.contactId, send.clubSlug),
    auditStatement(db, {
      clubSlug: send.clubSlug,
      contactId: send.contactId,
      scope: "bounce",
      source: "bounce",
      purpose: send.purpose,
      batchId: send.batchId,
      now,
    }),
  ]);
  return { clubSlug: send.clubSlug };
}
