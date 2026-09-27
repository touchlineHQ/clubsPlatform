/**
 * Per-club privacy notice (#75).
 *
 * The club is the data controller; touchlineHQ is the processor. Consent is
 * only valid when informed, so each club site must serve a notice naming the
 * controller, purposes, retention and rights. Generated from club_config —
 * no per-club free-text editing in this issue.
 *
 * Retention periods are placeholders pending legal confirmation; see
 * docs/DATA_PROTECTION.md.
 */

export type PrivacyNoticeClub = {
  slug: string;
  name: string;
  email?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    postcode?: string | null;
  } | null;
};

export type PrivacyNotice = {
  controller: {
    name: string;
    clubSlug: string;
    email: string | null;
    address: string | null;
  };
  processor: {
    name: string;
    role: string;
  };
  purposes: Array<{ purpose: string; basis: string; notes: string }>;
  retention: Array<{ data: string; period: string }>;
  rights: string[];
  marketingConsent: string;
  icoFeeNote: string;
  generatedAt: string;
};

const PROCESSOR_NAME = "touchlineHQ";

/** Generate the public notice from the club's controller details. */
export function buildPrivacyNotice(club: PrivacyNoticeClub): PrivacyNotice {
  const addressParts = [
    club.address?.line1,
    club.address?.line2,
    club.address?.postcode,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  return {
    controller: {
      name: club.name,
      clubSlug: club.slug,
      email: club.email?.trim() ? club.email.trim() : null,
      address: addressParts.length > 0 ? addressParts.join(", ") : null,
    },
    processor: {
      name: PROCESSOR_NAME,
      role:
        "Processes personal data only on the documented instructions of the club "
        + "and does not use parent or member contact data for its own marketing.",
    },
    purposes: [
      {
        purpose: "Membership and subscriptions (FAN, team, payment status)",
        basis: "Contract",
        notes: "Required to run the membership. No consent tick is offered or required.",
      },
      {
        purpose: "Service messages (subs due, fixture moved, training cancelled, kit)",
        basis: "Contract / legitimate interests",
        notes: "Needs a live registration at this club. You can object via the club contact below.",
      },
      {
        purpose: "Club marketing (fundraising, sponsors, shop) by email",
        basis: "Consent",
        notes:
          "Separate, unticked by default, withdrawable in one click from any marketing email. "
          + "Never set by a club admin on your behalf.",
      },
      {
        purpose: "Account login and password reset",
        basis: "Contract",
        notes: "Your account email is necessary for the service you requested.",
      },
      {
        purpose: "Audit and security logs",
        basis: "Legitimate interests",
        notes: "Retention limited; deleted contact addresses are not kept in the log.",
      },
    ],
    retention: [
      {
        data: "Active registration and payment history",
        period: "Life of the membership relationship + 6 years (limitation period).",
      },
      {
        data: "Lapsed registration",
        period: "6 years from last active season; marketing consent withdrawal does not delete the contact email.",
      },
      {
        data: "Unactivated contact invitation",
        period: "30 days, then one reminder, then purge.",
      },
      {
        data: "Withdrawn / purged contact email",
        period: "Immediate deletion from active tables.",
      },
      {
        data: "Session / IP / user-agent",
        period: "Session lifetime only.",
      },
      {
        data: "Admin audit log",
        period: "2 years, or longer if required for a live dispute.",
      },
    ],
    rights: [
      "Access — ask the club for a copy of the personal data it holds about you.",
      "Rectification — ask the club to correct inaccurate data.",
      "Erasure — ask the club to delete data it no longer needs (membership records needed for contract may be retained).",
      "Object — object to processing based on legitimate interests (e.g. some service messages).",
      "Withdraw marketing consent — use the unsubscribe link in any marketing email, or contact the club.",
      "Complain — you may complain to the ICO (https://ico.org.uk).",
    ],
    marketingConsent:
      "Marketing emails are sent only when you have a current granted consent record. "
      + "Withdrawing marketing consent does not affect membership or operational messages.",
    icoFeeNote:
      "UK organisations that process personal data generally need to pay the ICO data "
      + "protection fee. The club, as controller, is responsible for checking and paying "
      + "any fee that applies: https://ico.org.uk/for-organisations/data-protection-fee/",
    generatedAt: new Date().toISOString(),
  };
}
