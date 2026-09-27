/**
 * Per-club privacy notice (#75 / #146).
 *
 * The club is the data controller. Content is a fixed template filled with the
 * club's name and published contact details from club_config — not free-text
 * editing. Must stay aligned with docs/DATA_PROTECTION.md (what the DB holds).
 *
 * Retention periods are placeholders pending legal confirmation.
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
  /** Hosting / software provider — not a substitute for the club as controller. */
  hosting: {
    name: string;
    role: string;
  };
  /** @deprecated Prefer `hosting`; kept for older clients. */
  processor: {
    name: string;
    role: string;
  };
  held: string[];
  notHeld: string[];
  payments: string;
  purposes: Array<{ purpose: string; basis: string; notes: string }>;
  retention: Array<{ data: string; period: string }>;
  rights: string[];
  howToContact: string;
  marketingConsent: string;
  icoFeeNote: string;
  generatedAt: string;
};

const HOSTING_NAME = "touchlineHQ";

const HELD = [
  "Admin and member account logins (email, name, password hash / OAuth tokens)",
  "FA Number (FAN), team, registration status, and payment references",
  "Session security data (IP address and user-agent) for the life of the session",
  "Committee and coach contact details the club chooses to publish on this site",
  "Club contact email and address the club publishes about itself",
];

const NOT_HELD = [
  "Player or parent name (as a membership field)",
  "Date of birth",
  "Postal address of players or parents",
  "Phone number",
  "Medical information",
  "Safeguarding notes",
];

/**
 * Build the public notice. Always returns a notice when the club exists —
 * controller contact details are optional (club name is enough).
 */
export function buildPrivacyNotice(club: PrivacyNoticeClub): PrivacyNotice {
  const addressParts = [
    club.address?.line1,
    club.address?.line2,
    club.address?.postcode,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  const email = club.email?.trim() || null;
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;
  const contactHint = email
    ? `Email ${email}`
    : address
      ? `Write to ${address}`
      : "Use the Contact page on this site, or speak to a club official";

  const hostingRole =
    "Provides the clubsPlatform software and hosting used to run this club site. "
    + "The club decides what is stored and answers access, correction, and deletion "
    + "requests. While this deployment hosts only one real club (plus a fake demo) "
    + "and self-serve club registration is off, touchlineHQ is not operating as a "
    + "multi-tenant Art. 28 processor for other clubs' member data.";

  return {
    controller: {
      name: club.name,
      clubSlug: club.slug,
      email,
      address,
    },
    hosting: {
      name: HOSTING_NAME,
      role: hostingRole,
    },
    processor: {
      name: HOSTING_NAME,
      role: hostingRole,
    },
    held: [...HELD],
    notHeld: [...NOT_HELD],
    payments:
      "Subscriptions and registration fees are collected through GoCardless. "
      + "The club stores payment and mandate references only — not card numbers. "
      + "The FA Number (FAN) is used as the membership reference for payments.",
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
    howToContact:
      `To ask ${club.name} to correct or delete personal data it holds about you: ${contactHint}. `
      + "Membership FAN and payment history may be retained where the club still needs them for the membership contract.",
    marketingConsent:
      "Marketing emails are sent only when you have a current granted consent record. "
      + "Withdrawing marketing consent does not affect membership or operational messages.",
    icoFeeNote:
      "UK organisations that process personal data generally need to pay the ICO data "
      + "protection fee. The club, as controller, is responsible for checking and paying "
      + "any fee that applies: https://ico.org.uk/for-organisations/data-protection-fee/ "
      + "While this deployment hosts only one real club and self-serve registration is off, "
      + "touchlineHQ does not treat itself as needing a separate host ICO registration or "
      + "Art. 28 DPAs for other clubs — that changes if a second real club is hosted or "
      + "ALLOW_CLUB_SELF_REGISTER is turned on.",
    generatedAt: new Date().toISOString(),
  };
}
