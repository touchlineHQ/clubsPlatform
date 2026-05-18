<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the clubs platform. The `posthog-node` SDK was installed and a per-request helper (`functions/lib/posthog.ts`) was created to initialise a client from Cloudflare Pages env bindings using `flushAt: 1` / `flushInterval: 0` — the correct pattern for short-lived edge functions. Environment variables (`POSTHOG_API_KEY`, `POSTHOG_HOST`) were added to `.dev.vars` for local development. User identification is performed in `functions/api/me.ts` every time a session loads, keeping person profiles up to date. Auth errors are captured via `captureException` in the better-auth handler.

Twenty-three events are now instrumented across seventeen API route files covering the full lifecycle of the platform: club registration, GoCardless payment flows, pitch booking requests, team following, admin user management, subscription level administration, team role management, player payment management, bulk player and fixture imports, subscription rate configuration, and the public player payment funnel.

| Event | Description | File |
|---|---|---|
| `club registered` | A new club is registered on the platform | `functions/api/clubs/register.ts` |
| `payment link created` | An admin creates a GoCardless payment link for a player | `functions/api/gocardless/create-link.ts` |
| `payment completed` | A player's GoCardless payment is confirmed and a subscription created | `functions/api/gocardless/confirm.ts` |
| `payment failed` | A GoCardless payment or subscription creation fails | `functions/api/gocardless/confirm.ts` |
| `booking request submitted` | A manager submits a pitch booking request | `functions/api/booking-requests.ts` |
| `booking request approved` | An admin approves a pitch booking request | `functions/api/booking-requests.ts` |
| `booking request declined` | An admin declines a pitch booking request | `functions/api/booking-requests.ts` |
| `booking deleted` | An admin deletes a confirmed pitch booking | `functions/api/bookings.ts` |
| `team subscription created` | A user subscribes to follow a team | `functions/api/team-subscriptions.ts` |
| `team subscription deleted` | A user unsubscribes from following a team | `functions/api/team-subscriptions.ts` |
| `user role updated` | An admin updates another user's platform role | `functions/api/admin/users.ts` |
| `subscription level created` | An admin creates a new subscription level for a club | `functions/api/admin/subscription-levels.ts` |
| `team role assigned` | An admin assigns a coach, manager, or subscriber role on a team | `functions/api/admin/user-team-roles.ts` |
| `team role removed` | An admin removes a user's team role assignment | `functions/api/admin/user-team-roles.ts` |
| `player payment deactivated` | An admin marks a player's payment as inactive | `functions/api/admin/player-payments.ts` |
| `registration items updated` | An admin updates the club's registration page items | `functions/api/registration.ts` |
| `players imported` | An admin bulk-imports players from a spreadsheet, creating or updating player registrations and user accounts | `functions/api/admin/import-players.ts` |
| `fixtures imported` | An admin bulk-imports upcoming home fixtures from the club feed, auto-creating pending booking requests | `functions/api/admin/import-fixtures.ts` |
| `subscription level updated` | An admin updates the name, price, or interval of an existing subscription level | `functions/api/admin/subscription-levels/[id].ts` |
| `subscription level deleted` | An admin deletes a subscription level from the club | `functions/api/admin/subscription-levels/[id].ts` |
| `subscription rate assigned` | An admin maps a registration status (or team + status) to a subscription level | `functions/api/admin/status-subscription-levels.ts` |
| `subscription rate cleared` | An admin removes a status-based subscription rate mapping | `functions/api/admin/status-subscription-levels.ts` |
| `payment page viewed` | A player lands on the public payment setup page — the top of the subscription payment funnel | `functions/[clubSlug]/payments/[paymentType]/[fanId].ts` |

## Next steps

We've built a dashboard and five insights to keep an eye on user behaviour, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/689127)
- [Payment setup funnel](/insights/O5j26NkS) — conversion from payment page view through link creation to completed payment
- [Admin bulk imports over time](/insights/UQ3AHkrH) — players imported and fixtures imported week by week
- [Subscription level management](/insights/5dEXNzjl) — subscription levels created, updated, and deleted over time
- [Subscription rate configuration](/insights/AmzjTwF8) — subscription rates assigned vs cleared over time
- [Players imported per run](/insights/oEmkGLdI) — average new players and users created per import operation

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
