# Whitelabel Guide — Set Up Your Own Club Site

This site is designed to work for **any grassroots football club**. No coding required — just edit your club details and deploy.

## Quick Start

1. **Fork** this repository on GitHub
2. **Set up Cloudflare Pages** — connect your fork, set build command to `cd website && npm ci && npm run build`, output to `website/dist`
3. **Create a D1 database** — `npx wrangler d1 create clubsplatform-auth`, add the ID to `wrangler.toml`
4. **Set secrets** in Cloudflare dashboard: `BETTER_AUTH_SECRET` (random string), `GITHUB_TOKEN` (repo write access)
5. **Push to main** — your site deploys automatically

---

## Member Login

The site supports email/password login for club members. Features:

- **Members** can sign up and log in to access member-only content
- **Admins** get access to the site admin panel at `/#/customise`

To promote a user to admin, run in D1 console:
```sql
UPDATE user SET role = 'admin' WHERE email = 'your-email@example.com';
```

---

## Site Admin (Content Editor)

Admin users can edit all site content at `/#/customise`. Changes are saved directly to the GitHub repo, triggering an automatic redeploy.

| Tab | What you can edit |
|-----|-------------------|
| **Club** | Name, tagline, colours, socials, badge, address, about section, history |
| **Teams** | Sections (e.g. Seniors, Youth), individual teams, managers, coaches |
| **Committee** | Committee members and their roles |
| **News** | News articles with optional expandable body text |
| **Matchday** | Ground information, directions, facilities |
| **Registration** | Registration options with payment links |
| **Gallery** | Photo captions and images |

### How it works

1. Log in as an admin user
2. Click your name in the header, then **Site Admin**
3. Edit content through the web-based forms
4. Click **Apply Preview** to see changes live before saving
5. Click **Save to Site** — changes are committed to GitHub and the site redeploys

---

## Adding Images

Place your images in `website/public/images/` and reference them in the config as `images/filename.ext`.

You'll want:
- **Club badge** — shown on the home page (e.g. `images/badge.png`)
- **Section logos** — shown in the header (e.g. `images/seniors.png`)
- **Team photos** — shown on team cards (optional)
- **Ground image** — shown on the matchday page (optional)

---

## Choosing Your Colour

In the Club tab, select your **Primary Colour** from the dropdown. Available colours:

red, pink, grape, violet, indigo, blue, cyan, teal, green, lime, yellow, orange

The entire site theme updates automatically — buttons, badges, links, icons all follow your chosen colour.

---

## Deployment (Cloudflare Pages)

The site deploys to Cloudflare Pages with serverless Functions for authentication.

1. Connect your fork to **Cloudflare Pages** in the dashboard
2. Set build command: `cd website && npm ci && npm run build`
3. Set build output: `website/dist`
4. Add D1 database binding (`DB`) and environment secrets (`BETTER_AUTH_SECRET`, `GITHUB_TOKEN`)
5. Push to `main` — the site builds and deploys automatically

---

## Branch-per-Club Model

If multiple clubs want to share a single repository (e.g. a league or umbrella organisation):

1. Each club creates a branch (e.g. `club/riverside-fc`)
2. Each branch has its own `website/public/data/` and `website/public/images/`
3. Set up separate GitHub Pages deployments per branch, or use separate forks

This approach lets clubs pull upstream improvements (new features, bug fixes) from the `main` branch while keeping their own customisations.

---

## Live Fixture Feeds

The site can show live fixtures and results from the FA Full-Time system via [fulltimeFeeds](https://github.com/touchlineHQ/fulltimeFeeds).

To connect your club:
1. Set `clubFeedSlug` in club.json to your club's slug (e.g. `"my-club"`)
2. Set `teamSlugPrefix` to filter your teams (e.g. `"my-club-"`)
3. Set individual team `slug` fields in teams.json to match feed team names

If your club isn't in the fulltimeFeeds system yet, the fixtures pages will gracefully show "unavailable" — everything else works fine without it.

---

## Manual JSON Editing (Advanced)

If you prefer to edit JSON directly instead of using the customise page:

- `website/public/data/club.json` — Club identity, colours, socials, nav, about, history
- `website/public/data/teams.json` — Team sections and individual teams
- `website/public/data/committee.json` — Committee members
- `website/public/data/news.json` — News articles
- `website/public/data/matchday.json` — Ground/facility information
- `website/public/data/registration.json` — Registration links
- `website/public/data/gallery.json` — Photo gallery

You can edit these directly in GitHub's web editor — no local setup needed.

---

## Updating from Upstream

To pull new features and fixes from the original repo:

```bash
git remote add upstream https://github.com/adamsuk/ELBantams.git
git fetch upstream
git merge upstream/main
```

Your `data/` and `images/` files won't conflict since they're specific to your club.
