# Data protection boundary

Structural design note, not legal advice. Confirm basis mapping and retention periods with qualified advice before launch.

This file is the authoritative statement of what the platform holds, what it refuses to hold, and why. A PR that stores a new personal-data field must update this file and name the lawful basis that covers it. Reviewers should reject a widening of the PII surface that is not reflected here.

## Blind-asset principle

`player` holds only `fanId` and timestamps (`migrations/0011_add_player_tables.sql`). It is deliberately blind: no name, no date of birth, no address, no contact details.

The FA Number (FAN) is a stable identifier for a registration asset. Linking it to a real-world identity (name, email, phone) turns the platform from a processor of membership state into a holder of Direct PII. Once both a FAN and a contact email exist in the same system, a database compromise reveals exactly which address is attached to which player profile and payment history.

Adding any identifying field to `player` breaks the boundary. Contact data belongs in a separate table with its own lifecycle, consent state, and deletion path (see planned `player_contact` in #131).

## Held / not held

### Out of bounds (never held, never imported, rejected by payload validation)

- Name (player or parent)
- Date of birth
- Postal address
- Phone number
- Medical information
- Safeguarding notes

These fields appear on FA export CSVs. The import path must strip them; tests already assert that name and DOB are not posted (`ImportPlayersPanel.test.tsx`).

### Tables that hold personal data today

| Table | Fields of interest | Lawful basis | Notes |
|-------|--------------------|--------------|-------|
| `user` | `email`, `name`, `image` | Contract (account holder’s own login) | Admin accounts and any parent who has signed up. `email` is the auth identity. |
| `session` | `ipAddress`, `userAgent` | Legitimate interests (security / session integrity) | Short-lived; expires with the session. |
| `account` | `password` (hash), OAuth tokens | Contract | Credential storage for the account holder. |
| `verification` | token identifiers | Contract | Password-reset / verification tokens; short expiry. |
| `user_player` | link between `user` and `player` | Contract | Records that an account is linked to a FAN (self or guardian). |
| `player` | `fanId` | Contract | Blind asset identifier only. |
| `player_registration` | team, age group, status, expiry | Contract | Membership state for a club season. |
| `player_payment` | mandate / subscription references | Contract | Payment state; no card numbers. |
| `booking_request` | linked to `userId`, notes | Contract / legitimate interests | Pitch booking requests. |
| `committee_member` | `name`, `contact` | Legitimate interests / contract | Club-published roles; often public on the site. |
| `team` | `manager`, `coach`, `contact` | Legitimate interests / contract | Club-published team contacts. |
| `admin_audit_log` | `adminId`, action, target | Legitimate interests (accountability) | Must not store deleted contact addresses. |
| `club_config` / content JSON | club contact email inside `data` blob | Contract (club’s own details) | Club identity, not parent data. |

### Current gap (until children of #128 land)

`functions/api/admin/import-players.ts` accepts `playerEmail` and `parentEmails` from the FA CSV and creates `user` + `account` rows for every distinct address. Those addresses therefore live in the auth `user` table with no consent record, no pending state, and no safe deletion path that leaves the membership record intact.

This is a live breach of the boundary described above. It is intentional that this document names the gap rather than describing only the target state. Closing work:

- #131 — `player_contact` table (contact email ceases to be an auth identity)
- #130 — club sign-off before contact-email collection is enabled
- #132 onwards — activation, purpose separation, purge, unsubscribe (mail-dependent; out of scope for the pure data-boundary work)

Until those land, treat every imported contact email as Direct PII held without the guardrails this document requires.

## Controller and processor

- **Each club is the data controller** of its members’ and contacts’ data.
- **touchlineHQ is the processor.** It processes data only on the documented instructions of the club and does not use parent contact data for its own marketing or platform promotions.

A written processor agreement (UK GDPR Art. 28) is required; see #75. Club signup must eventually record acceptance of a versioned DPA.

Sending party is always the club. Every outbound communication (when mail exists) is sent on behalf of a named club. touchlineHQ does not email parents about platform updates.

## Lawful basis per purpose

| Purpose | Basis | Eligibility / notes |
|---------|-------|---------------------|
| Membership and subs (FAN, team, registration status, payment state) | **Contract** | No consent tick. Required to run the membership. |
| Operational club admin (fixtures, cancellations, safety, kit sizing, subs reminders) | **Contract / legitimate interests** | Requires a live registration at the sending club. Objection route required. |
| Club marketing (sponsor news, shop, fundraising) | **Explicit consent** | Separate, unticked, parent-set, withdrawable in one click. Never settable by a club admin. |
| Account holder’s own login and password reset | **Contract** | The account holder’s email is necessary for the service they requested. |
| Audit / security logs | **Legitimate interests** | Retention limited; no deleted addresses. |

Consent is the wrong basis for membership data. Bundling everything into one tick would mean a later withdrawal obliged the club to stop processing data it needs to collect subs.

## Retention

Concrete periods (placeholders pending legal confirmation):

| Data | Retention |
|------|-----------|
| Active registration + payment history | For the life of the membership relationship + **6 years** (limitation period for contract claims). |
| Lapsed registration (no active status) | Membership record retained **6 years** from last active season; contact email (once separated) purged or suppressed earlier per below. |
| Unactivated contact invitation (`pending`) | **30 days**, then one reminder, then purge. A pending address is held without consent and must not sit indefinitely. |
| Withdrawn / purged contact email | Immediate deletion from active tables; salted hash retained only for re-import suppression (no plaintext). |
| Session / IP / user-agent | Session lifetime only. |
| Admin audit log | **2 years**, or longer if required for a live dispute. Must not contain deleted contact addresses. |
| Club leaving the platform | Export offered; residual contact data purged within **90 days** of offboarding unless a legal hold applies. |

D1 backups and any provider-side logs will retain copies after deletion. A retention answer for backups belongs with the operational runbook and should be stated explicitly when mail and contact flows go live.

## What a PR author must do

When a change stores a new personal-data field (or changes how an existing one is used):

1. Update this file: add or amend the table row, basis, and retention.
2. State the basis in the PR description.
3. If the field is Direct PII (email, phone, name, etc.), confirm it is not being added to `player` and that a deletion / purge path exists or is tracked.
4. Reject name, DOB, address, medical or safeguarding data at the validation boundary; do not store them “just in case”.

## Related issues

- #128 — umbrella for the contact-email boundary
- #129 — this document
- #131 — `player_contact` schema
- #130 — club sign-off gating collection
- #75 — consent records, privacy notice, processor agreement
- #134 — one-click purge (once contact is separated from auth)
