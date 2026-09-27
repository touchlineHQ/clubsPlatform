import type { D1Database } from "@cloudflare/workers-types";
import { hasCurrentMarketingConsent } from "./consent";

/**
 * Purpose a club may send to a contact address for.
 *
 * Operational and marketing are separate at the schema level (see #128 / #131).
 * A send path must name one; there is no "both" / "any" shortcut.
 */
export type ContactPurpose = "operational" | "marketing";

export type ContactState = "pending" | "confirmed" | "withdrawn" | "bounced";

export interface PlayerContactForSend {
  id: string;
  email: string;
  state: ContactState;
  operationalOptIn: number;
  marketingOptIn: number;
}

/**
 * Whether a contact row's local columns look eligible for `purpose`.
 *
 * For marketing, callers that can hit the DB must use emailForSend (or
 * hasCurrentMarketingConsent) — marketingOptIn is a denormalised mirror of
 * consent_record and is not authoritative on its own (#75).
 */
export function isContactSendable(
  contact: Pick<PlayerContactForSend, "state" | "operationalOptIn" | "marketingOptIn">,
  purpose: ContactPurpose,
): boolean {
  if (contact.state !== "confirmed") return false;
  if (purpose === "operational") return contact.operationalOptIn === 1;
  return contact.marketingOptIn === 1;
}

/**
 * Resolve a contact address for sending within `clubSlug`. Returns null when
 * the row is missing, belongs to another club, or is not eligible for `purpose`.
 *
 * Marketing requires a current granted consent_record (#75) in addition to a
 * confirmed contact. Operational still uses the operationalOptIn column.
 * Do not SELECT player_contact.email (or fall back to user.email) for outbound
 * mail outside this helper.
 */
export async function emailForSend(
  db: D1Database,
  clubSlug: string,
  contactId: string,
  purpose: ContactPurpose,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id, email, state, operationalOptIn, marketingOptIn
         FROM "player_contact" WHERE id = ? AND clubSlug = ?`,
    )
    .bind(contactId, clubSlug)
    .first<PlayerContactForSend>();

  if (!row || row.state !== "confirmed") return null;

  if (purpose === "operational") {
    if (row.operationalOptIn !== 1) return null;
    return row.email;
  }

  // Marketing: consent_record is authoritative. marketingOptIn is synced on
  // grant/withdraw but a stale 1 must not leak past a withdrawn consent.
  const consented = await hasCurrentMarketingConsent(
    db,
    clubSlug,
    "player_contact",
    contactId,
  );
  if (!consented) return null;
  return row.email;
}
