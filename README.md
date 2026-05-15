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

For local-only overrides without editing `wrangler.toml`, create a `.dev.vars` file (gitignored by Wrangler):

```
BETTER_AUTH_URL=http://localhost:8788
```

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
