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
