import type { D1Database } from "@cloudflare/workers-types";
import { hasCurrentMarketingConsent } from "./consent";
import {
  isLiveRegistrationStatus,
  liveRegistrationStatusForPlayer,
  type EmailPurpose,
} from "./send-guard";

/**
 * Purpose a club may send to a contact address for.
 *
 * Purposes are separate at the schema / guard level (see #128 / #131 / #133).
 * A send path must name one; there is no "both" / "any" shortcut.
 *
 * Prefer sendClubEmail (send-guard) for outbound mail — it derives recipients
 * and records drops. emailForSend remains for single-id eligibility probes.
 */
export type ContactPurpose = EmailPurpose;

export type ContactState = "pending" | "confirmed" | "withdrawn" | "bounced";

export interface PlayerContactForSend {
  id: string;
  email: string;
  playerId: string;
  state: ContactState;
  operationalOptIn: number;
  marketingOptIn: number;
}

/**
 * Whether a contact row's local columns look eligible for `purpose`.
 *
 * Operational also needs a live registration (checked in emailForSend).
 * For marketing, callers that can hit the DB must use emailForSend —
 * marketingOptIn is a denormalised mirror of consent_record (#75).
 */
export function isContactSendable(
  contact: Pick<PlayerContactForSend, "state" | "operationalOptIn" | "marketingOptIn">,
  purpose: ContactPurpose,
): boolean {
  if (contact.state !== "confirmed") return false;
  if (purpose === "transactional") return true;
  if (purpose === "operational") return contact.operationalOptIn === 1;
  return contact.marketingOptIn === 1;
}

/**
 * Resolve a contact address for sending within `clubSlug`. Returns null when
 * the row is missing, belongs to another club, or is not eligible for `purpose`.
 *
 * - transactional: confirmed contact
 * - operational: confirmed + operationalOptIn + live registrationStatus (#133)
 * - marketing: confirmed + current granted consent_record (#75)
 *
 * Do not SELECT player_contact.email (or fall back to user.email) for outbound
 * mail outside this helper or sendClubEmail.
 */
export async function emailForSend(
  db: D1Database,
  clubSlug: string,
  contactId: string,
  purpose: ContactPurpose,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id, email, playerId, state, operationalOptIn, marketingOptIn
         FROM "player_contact" WHERE id = ? AND clubSlug = ?`,
    )
    .bind(contactId, clubSlug)
    .first<PlayerContactForSend>();

  if (!row || row.state !== "confirmed") return null;

  if (purpose === "transactional") {
    return row.email;
  }

  if (purpose === "operational") {
    if (row.operationalOptIn !== 1) return null;
    const status = await liveRegistrationStatusForPlayer(db, clubSlug, row.playerId);
    if (!isLiveRegistrationStatus(status)) return null;
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
