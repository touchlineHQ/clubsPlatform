<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the clubs platform. The `posthog-node` SDK was installed and a per-request helper (`functions/lib/posthog.ts`) was created to initialise a client from Cloudflare Pages env bindings using `flushAt: 1` / `flushInterval: 0` — the correct pattern for short-lived edge functions. Environment variables (`POSTHOG_API_KEY`, `POSTHOG_HOST`) were added to `.dev.vars` for local development. User identification is performed in `functions/api/me.ts` every time a session loads, keeping person profiles up to date. Auth errors are captured via `captureException` in the better-auth handler.

Sixteen events are now instrumented across twelve API route files covering the full lifecycle of the platform: club registration, GoCardless payment flows, pitch booking requests, team following, admin user management, subscription level administration, team role management, and player payment management.

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

## Next steps

We've built a dashboard and five insights to keep an eye on user behaviour, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/688711)
- [Payment completions over time](/insights/jnJULGKD) — completed vs failed payments week by week
- [Payment link to completion funnel](/insights/mPmcHy84) — drop-off from payment link creation to completed payment
- [New club registrations](/insights/RdfPdXcM) — new clubs joining the platform over time
- [Booking request outcomes](/insights/9gEuE02I) — submitted, approved, and declined booking requests
- [User engagement actions](/insights/zJDSZ5OB) — team subscriptions, role assignments, and subscription levels created

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
