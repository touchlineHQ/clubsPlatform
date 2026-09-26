import type { D1Database } from "@cloudflare/workers-types";

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
 * Whether a contact row is eligible to receive mail for `purpose`.
 *
 * The only gate callers may use. Do not SELECT `player_contact.email` (or
 * fall back to `user.email`) for outbound mail outside this helper — that is
 * how pending / withdrawn / marketing-without-consent addresses leak onto the
 * wire. The send guard in #133 builds on this.
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
 * Resolve a contact address for sending. Returns null when the row is missing
 * or not eligible for `purpose`.
 */
export async function emailForSend(
  db: D1Database,
  contactId: string,
  purpose: ContactPurpose,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id, email, state, operationalOptIn, marketingOptIn
         FROM "player_contact" WHERE id = ?`,
    )
    .bind(contactId)
    .first<PlayerContactForSend>();

  if (!row || !isContactSendable(row, purpose)) return null;
  return row.email;
}
