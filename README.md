# clubsPlatform

A white-label website platform for grassroots football clubs, built with React and TypeScript, deployed to Cloudflare Pages with a D1 (SQLite) backend.

Supports two modes:
- **Single-club** — fork the repo for one club, edit JSON files, deploy
- **Multi-club** — one deployment hosts many clubs with a shared landing page, DB-backed content, and self-service sign-up

## Tech Stack

- **React 19** + TypeScript
- **Vite 6** for bundling
- **Mantine v9** component library (theme colour configurable per club)
- **React Router v7** (HashRouter)
- **Cloudflare Pages Functions** for the API
- **Cloudflare D1** (SQLite) for club data, auth, and bookings
- **better-auth v1** for authentication

## Getting Started

```bash
npm install        # install root + UI deps
make dev           # migrate DB, start Wrangler API + Vite (http://localhost:5173)
```

### Other targets

```bash
make worker          # Wrangler API only (port 8788)
make ui              # Vite UI only (port 5173)
make ui-remote       # Vite UI pointing at production API
make preview         # Preview built Pages output locally
make db-migrate-local   # Apply migrations to local D1
make db-migrate-prod    # Apply migrations to production D1
```

## Environment Variables

Set in `wrangler.toml` under `[vars]`:

| Variable | Description | Default |
|----------|-------------|---------|
| `BETTER_AUTH_SECRET` | Auth signing secret | required |
| `BETTER_AUTH_URL` | Override auth base URL | auto-detected |
| `MULTI_CLUB` | Enable multi-club platform mode | disabled |
| `PITCH_BOOKINGS` | Enable pitch scheduling & booking features | disabled |
| `SECRETS_ENCRYPTION_KEY` | AES-256-GCM key for at-rest secret encryption (64 hex chars) | required for secrets |
| `SECRETS_TRANSPORT_PRIVATE_KEY` | RSA-2048 PKCS8 private key for transport decryption | required for secrets |
| `SECRETS_TRANSPORT_PUBLIC_KEY` | RSA-2048 SPKI public key sent to the browser | required for secrets |
| `POSTHOG_HOST` | PostHog ingest host used by the Pages Functions | analytics disabled if unset |
| `SMTP_HOST` | Hostname of the SMTP relay that sends transactional email | email disabled if unset |
| `SMTP_PORT` | Relay port. Cloudflare blocks 25 — use 465 or 587 | `465` |
| `SMTP_SECURE` | `true` for implicit TLS (465), `false` to upgrade with STARTTLS (587) | `true` |
| `SMTP_USER` | Mailbox to authenticate as | email disabled if unset |
| `SMTP_TIMEOUT_MS` | Give up on a relay that stops answering | `20000` |
| `FROM_EMAIL` | Address messages are sent from | email disabled if unset |

For local-only overrides without editing `wrangler.toml`, create a `.dev.vars` file (gitignored by Wrangler):

```
BETTER_AUTH_URL=http://localhost:8788
```

### Analytics (PostHog)

Analytics span three separate places, which is easy to get wrong:

| Value | Where it is set | Notes |
|-------|-----------------|-------|
| `POSTHOG_API_KEY` | Pages **secret**, per environment | Backend (`functions/`). See below — it cannot be set in the dashboard UI. |
| `POSTHOG_HOST` | `wrangler.toml`, in **both** env blocks | Backend (`functions/`). |
| `VITE_POSTHOG_API_KEY` | GitHub Actions repository **variable** | Frontend. Injected at build time in `.github/workflows/main.yml`. |
| `VITE_POSTHOG_HOST` | GitHub Actions repository **variable** | Frontend. |
| `POSTHOG_CLI_API_KEY` | GitHub Actions repository **secret** | Source map upload. A **personal** API key — not the same thing as `POSTHOG_API_KEY`. See below. |
| `POSTHOG_CLI_PROJECT_ID` | GitHub Actions repository **variable** | Source map upload. `181812`. |
| `POSTHOG_CLI_HOST` | GitHub Actions repository **variable** | Source map upload. `https://eu.posthog.com` — the **app** host, not the ingest host in `VITE_POSTHOG_HOST`. |

⚠️ `POSTHOG_CLI_API_KEY` and `POSTHOG_API_KEY` are different credentials and the
similarity of the names is a trap. `POSTHOG_API_KEY` is a project write key: it
can only send events, and the frontend equivalent ships publicly in the client
bundle anyway. `POSTHOG_CLI_API_KEY` is a *personal* API key scoped to
`error tracking: write` and `organization: read`, which is why it is a repository
secret and must never become a variable or reach the browser.

Two things about this project make the obvious approach fail:

**The dashboard's Functions environment variables are read-only.** Because a
`wrangler.toml` is present, Cloudflare treats it as [the source of truth]
(https://developers.cloudflare.com/pages/functions/wrangler-configuration/#source-of-truth)
for this Pages project — you can see those fields in the dashboard but not
edit them. So `POSTHOG_API_KEY` has to be set as a secret, which
`wrangler.toml` does not govern:

```sh
npx wrangler pages secret put POSTHOG_API_KEY --project-name clubsplatform
npx wrangler pages secret put POSTHOG_API_KEY --project-name clubsplatform --env preview
```

`getPostHog()` returns `null` unless **both** `POSTHOG_API_KEY` and
`POSTHOG_HOST` are present, and every call site is guarded by `if (posthog)`.
A missing value therefore disables backend analytics silently — no error, no
log. If backend events stop arriving, check these first.

**The dashboard's build environment variables never run.** Deployment is a
direct upload (`wrangler pages deploy website/dist`) from GitHub Actions, not
a Cloudflare Git integration, so *Build settings → environment variables* is
not part of the build at all. The `VITE_*` values must be set as repository
variables and passed through the workflow's build step.

Note that `vars` is non-inheritable for Pages: because both `[env.production]`
and `[env.preview]` override it, a variable added only to the top-level
`[vars]` block will not reach either deployment. Add it to both env blocks.

### Source maps

The frontend ships as one minified chunk, so an exception captured in
production arrives pointing at something like `/assets/index-jayiAzaL.js:1` —
which tells you nothing. `website/vite.config.mts` registers
`@posthog/rollup-plugin`, which stamps a chunk id into the bundle, uploads the
source maps to PostHog, and then deletes them so they are never served to
users.

The plugin is only registered when `POSTHOG_CLI_API_KEY` is present. Without
it — local builds, the pull-request workflow, a fork — the build behaves
exactly as it did before and uploads nothing. Only the deploy workflow on
`main` carries the secret, so only real deployments create a release.

**A failed upload does not fail the build.** Out of the box the plugin throws
when `posthog-cli` exits non-zero — an unreachable PostHog, or a personal API
key that has been rotated or expired. Since the `Build` step gates
`wrangler pages deploy`, that would stop the site from shipping because
analytics tooling had a bad day. `vite.config.mts` wraps the plugin so an
upload failure logs a warning and the build carries on. The wrapper also
deletes the source maps itself in that case: the plugin only removes them after
a *successful* upload, so without the cleanup a swallowed error would publish
our source maps to Cloudflare Pages. If that cleanup ever fails, the build
fails — shipping is worth more than symbolication, but not worth leaking
source.

Two more things to know if you touch this:

- **`vite.config.mts` must keep the `.mts` extension.** The plugin is ESM-only
  and `website/package.json` has no `"type": "module"`, so a `vite.config.ts`
  is loaded as CommonJS and the build dies on `ESM file cannot be loaded by
  require`. `website/tsconfig.json` names the file explicitly so it is still
  type-checked.
- **Don't set `build.sourcemap`.** The plugin's own Vite `config` hook sets it
  to `'hidden'` when it is active. Setting it here would emit maps on every
  build, including the ones that never upload them.

### Self-driving

PostHog [self-driving](https://posthog.com/docs/self-driving) watches the
product's data, investigates what looks broken, and drafts fixes. Error
tracking is enabled as a signal source for this project — new issues, reopened
issues, and issues whose volume is spiking all become reports in the
[inbox](https://eu.posthog.com/project/181812/inbox).

This is why the source map setup above matters: a report about a minified
stack frame is not something anyone, human or agent, can act on.

Two deliberate limits on how far it can go:

- **PostHog cannot push to this repository.** The GitHub integration currently
  has read-only access (`can_push: false` on every repo it can see), so no
  pull request will be opened. Granting the PostHog GitHub App write access on
  `touchlineHQ/clubsPlatform` is what turns that on, and is the one switch to
  flip when the reports look good enough to act on.
- **Spend is capped by the billing limit**, not by anything in this repo. The
  first 3 PRs each month are free, then $15 each against a $150 default limit,
  set under [organization billing](https://eu.posthog.com/organization/billing).

No scouts (scheduled agents that comb the data on a timer) are configured. The
error tracking source emits on its own, so a scout would add cost without
adding coverage at this volume.

## Transactional Email

Password resets, sign-up verification and player-import invitations are sent
through **any SMTP relay** — the club's own mailbox provider, a transactional
service's SMTP endpoint, whatever the committee already pays for.

| Value | Where it is set |
|-------|-----------------|
| `SMTP_PASSWORD` | Pages **secret**, per environment. Cannot be set in the dashboard — same reason as `POSTHOG_API_KEY`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `FROM_EMAIL` | `wrangler.toml`, in **both** env blocks. |

```sh
npx wrangler pages secret put SMTP_PASSWORD --project-name clubsplatform
npx wrangler pages secret put SMTP_PASSWORD --project-name clubsplatform --env preview
```

For local dev, put the lot in `.dev.vars`:

```
SMTP_HOST=smtp.purelymail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=committee@yourdomain.com
SMTP_PASSWORD=your_secure_password
FROM_EMAIL=committee@yourdomain.com
```

`getMailer()` returns `null` unless `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`
and `FROM_EMAIL` are **all** set, and every call site is guarded. A missing
value therefore disables sending silently — exactly like the PostHog pair
above, and for the same reason: a club without mail configured should still be
able to log in, import players and take payments. If resets stop arriving,
check these first.

### Why there is a hand-written SMTP client

`functions/lib/smtp.ts` speaks SMTP over `cloudflare:sockets` in about 250
lines. That is not a preference — nodemailer wants `net`, `tls` and `dns`, none
of which exist on workerd, and Workers cannot use it. Raw TCP sockets are the
supported route, so the protocol is ours to implement. It does exactly one
thing: submit one already-formed message to one recipient through an
authenticated relay. No pooling, no pipelining, no MX delivery, no bounce
handling — the relay owns all of that.

Three constraints worth knowing before you change any of it:

- **Port 25 will not work.** Cloudflare blocks outbound connections on it from
  Workers. 465 and 587 are open.
- **Credentials never go out unencrypted.** With `SMTP_SECURE=true` the socket
  is TLS from the first byte. With `false` it connects in the clear and
  upgrades, and if the relay does not advertise STARTTLS the send is abandoned
  rather than downgraded. Data buffered before the handshake aborts the session
  too — that is the STARTTLS injection bug.
- **Both bodies are base64, not quoted-printable.** It costs a third more bytes
  and removes three problems at once: no line can exceed SMTP's 998-octet
  limit, no line can begin with a bare `.` and need dot-stuffing, and non-ASCII
  in a club's name survives intact.

`AUTH PLAIN` is preferred over `AUTH LOGIN` — one round trip instead of three,
and by then the channel is encrypted either way.

Tests drive the client against a scripted fake socket
(`functions/__tests__/lib/fake-smtp-socket.ts`) that plays a real server
dialogue. `cloudflare:sockets` has no Node equivalent, so `vitest.config.ts`
aliases it to a stub that throws: a test that forgets to inject a scripted
`connect()` fails loudly instead of dialling out.

### Mail reads as the club, not the platform

A parent signed up with their club and will treat "Club Platform" as spam. So
each message is addressed from the club:

- **Display name** — `club_config.name`.
- **Reply-to** — the club's own contact address from its content blob, when set.
- **Links** — into that club's site, including the `/<slug>/` prefix in
  multi-club mode, and into the fragment, because the app is a HashRouter.

The **address** stays `FROM_EMAIL`, because that is the mailbox the relay will
let us authenticate as. The display name is club-editable text going into a
mail header, so `formatFrom()` strips anything that could open a new one.

### What is sent

| Trigger | Link goes to | Expires |
|---------|--------------|---------|
| Forgot password | `/#/reset-password?token=…` | 1 hour, single use |
| Sign-up | `/api/auth/verify-email`, which redirects back to the club | 1 hour |
| Player import creates an account | `/#/reset-password?token=…` | 7 days |

The import invitation is a longer-lived reset token, minted by
`createSetPasswordToken()`. That writes a `verification` row by hand, so it
depends on two details of better-auth's storage — the `reset-password:<token>`
identifier and ISO-string dates on SQLite. Both are asserted by
`functions/__tests__/lib/set-password-token.test.ts`; read the comment there
before changing it.

### Failures are recorded, not raised

A delivery failure in an auth flow is swallowed and sent to PostHog error
tracking instead of surfacing. `sendResetPassword` only runs once a user has
been found, so a 500 on some addresses and a cheerful "check your email" on
others would tell an attacker which accounts exist. Sign-up verification is
swallowed for a different reason: it runs inline inside sign-up, so a provider
outage would otherwise stop people creating accounts.

The player import is the exception that reports back — it returns `invited` and
`inviteFailed` counts, and the import panel says plainly when nothing went out.

### Email verification is recorded but not enforced

`requireEmailVerification` is deliberately off. Every account that predates this
— including every parent the FA import created — has `emailVerified = 0`, so
turning it on would lock out the entire user base on deploy. Enforcing it needs
a backfill first.

## API Secrets

Club admins can store encrypted API keys (e.g. `GC_ACCESS_TOKEN`) via the **API Secrets** page in the admin dashboard (`/#/admin/secrets`). Values are encrypted in the browser before transmission and stored with AES-256-GCM — the plaintext never touches the network or the database.

### Generating the required keys

**At-rest encryption key** (32 random bytes as hex):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the output as `SECRETS_ENCRYPTION_KEY`.

**Transport key pair** (RSA-2048):

```bash
node -e "
const c = require('crypto');
const { privateKey, publicKey } = c.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});
console.log('SECRETS_TRANSPORT_PRIVATE_KEY=' + privateKey.toString('base64'));
console.log('SECRETS_TRANSPORT_PUBLIC_KEY='  + publicKey.toString('base64'));
"
```

For **local dev** add all three to `.dev.vars` (gitignored by Wrangler).
For **production** set `SECRETS_ENCRYPTION_KEY` and `SECRETS_TRANSPORT_PRIVATE_KEY` as Cloudflare dashboard secrets. `SECRETS_TRANSPORT_PUBLIC_KEY` can go in `wrangler.toml` under `[vars]` since it is not sensitive.

## Multi-Club Mode

Set `MULTI_CLUB = "true"` in `wrangler.toml` to activate:

- Root URL shows the **landing page** (club directory + self-service sign-up)
- Each club is served at `/{slug}/`
- Club data is stored in D1 and seeded from static JSON on first access
- Any authenticated user can create their own club and become its admin

### Seeding

On first access to a club, the API seeds the database from static JSON files at:

```
website/public/data/clubs/{slug}/
├── club.json
├── teams.json
├── committee.json
├── news.json
├── registration.json
├── gallery.json
└── matchday.json
```

Once seeded (or saved via the admin panel), the DB is the source of truth. To re-seed from JSON, reset `seeded = 0` in `club_config` for that slug.

## Admin Panel

Admins can edit all club content at `/#/customise`:

- **Club Info** — name, tagline, colours, address, socials, shop URL, about items, history
- **Teams** — sections and team list
- **Committee** — roles and members
- **News** — news items
- **Registration** — registration links
- **Gallery** — photo captions and paths
- **Matchday** — directions, parking, facilities

Changes save to D1 via the API and take effect immediately.

## Feature Flags

| Flag | What it shows |
|------|---------------|
| `PITCH_BOOKINGS = "true"` | Pitch Schedule, Request a Pitch, Booking Requests in the sidebar |

## Project Structure

```
├── functions/               # Cloudflare Pages Functions (API)
│   ├── api/                 # Route handlers
│   └── lib/                 # Shared helpers (auth, DB, seeding)
├── migrations/              # D1 SQL migrations
├── website/
│   ├── public/
│   │   ├── data/
│   │   │   ├── clubs/       # Per-club JSON seed files
│   │   │   │   └── {slug}/  # club.json, teams.json, etc.
│   │   │   └── index.json   # Club registry (single-club fallback)
│   │   └── images/          # Static images
│   └── src/
│       ├── pages/           # One component per route
│       ├── components/      # SiteHeader, SiteSidebar, admin forms
│       ├── context/         # Auth, Club, Section contexts
│       ├── App.tsx          # Registry loading + routing
│       ├── data.ts          # Data loading (API + static fallback)
│       ├── types.ts         # TypeScript interfaces
│       └── theme.ts         # Mantine theme (colour from club data)
└── wrangler.toml            # Cloudflare config + feature flags
```

## Routes

| Route | Page | Notes |
|-------|------|-------|
| `/` | Home | |
| `/about` | Club story & about | Hidden if no content set |
| `/teams` | All teams | Hidden if no teams |
| `/teams/:league/:teamSlug` | Team fixtures/results | |
| `/fixtures` | Club-wide fixtures feed | Hidden if no teams |
| `/register` | Registration links | Hidden if no items |
| `/committee` | Committee members | Hidden if no members |
| `/news` | News articles | Hidden if no items |
| `/gallery` | Photo gallery | Hidden if no items |
| `/matchday` | Matchday info | Hidden if no items |
| `/contact` | Contact | Hidden if no email/address |
| `/schedule` | Pitch schedule | Requires `PITCH_BOOKINGS` |
| `/bookings` | Request a pitch | Requires `PITCH_BOOKINGS` + manager/admin |
| `/admin/bookings` | Booking requests | Requires `PITCH_BOOKINGS` + admin |
| `/customise` | Admin panel | Admin only |
| `/admin/users` | User management | Admin only |

## Deployment

Deploy to Cloudflare Pages. Set the build command and output directory in the Pages dashboard:

```
Build command:   cd website && npm install && npm run build
Build output:    website/dist
```

Apply production migrations after deploying:

```bash
make db-migrate-prod
```
