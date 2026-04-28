# Clubs Platform

A white labelled website for grassroots football clubs, built with React and TypeScript, deployed to Cloudflare Pages.

## Use This for Your Own Club

This site is **whitelabel** — any grassroots football club can fork it and make it their own, with zero coding required. All content is driven by JSON files you can edit in a browser.

**Quick start:**

1. **Fork** this repository
2. Visit `/#/customise` on the live site to use the built-in editor
3. Fill in your club details, pick your colour, set up teams
4. Click **Export ZIP** and replace the files in `website/public/data/`
5. Add your images to `website/public/images/`
6. Enable **GitHub Pages** (Settings > Pages > Source: GitHub Actions)
7. Push to `main` — your site deploys automatically

alternatively this can be deployed on CloudFlare Pages with workers for a serverless authentication solution.

See [WHITELABEL.md](WHITELABEL.md) for the full guide, including the branch-per-club model, live fixture feeds, and manual JSON editing.

## Tech Stack

- **React 18** with TypeScript
- **Vite** for bundling
- **Mantine 7** component library (theme colour configurable per club)
- **React Router 6** (HashRouter for GitHub Pages compatibility)
- **pnpm** as package manager

## Getting Started

### Frontend Only
```bash
cd website/
npm install
npm run dev
```

### Full Stack (Frontend + Serverless API)
This runs the Vite dev server with the Cloudflare Workers API proxy:
```bash
make dev
```
Access at http://localhost:5173 — API calls proxied to wrangler on port 8788.

### Other Targets
```bash
make worker    # Run wrangler API only (port 8788)
make ui        # Run Vite UI only (port 5173)
make preview   # Preview production build
```

### Database Migrations
```bash
make db-migrate-local  # Apply migrations to local D1
make db-migrate-prod   # Apply migrations to production D1
```

### Environment Variables
The wrangler config (`wrangler.toml`) includes:
- `BETTER_AUTH_SECRET` — Auth secret
- D1 database binding `DB`

For local development, create a `.dev.vars` file:
```
BETTER_AUTH_SECRET=your-secret-here
BETTER_AUTH_URL=http://localhost:8788
```

## Project Structure

```
website/
├── public/
│   ├── data/           # Site content as JSON files (edit these to update content)
│   │   ├── club.json       — Club name, address, socials, about, history
│   │   ├── teams.json      — Teams with manager/coach/contact details
│   │   ├── committee.json  — Committee members and roles
│   │   ├── registration.json — Registration links per section
│   │   ├── news.json       — News articles
│   │   ├── gallery.json    — Gallery photo captions and paths
│   │   └── matchday.json   — Matchday info (directions, parking, facilities)
│   └── images/         # Static images
└── src/
    ├── pages/          # One component per route
    ├── components/     # SiteHeader, SiteSidebar
    ├── utils/          # Icon mappings
    ├── App.tsx         # Routes
    ├── data.ts         # Data loading
    ├── types.ts        # TypeScript interfaces
    └── theme.ts        # Mantine theme (colour from club.json)
```

## Updating Content

All site content is driven by JSON files in `public/data/` — no code changes needed for most updates. Edit the relevant JSON file and push to `main` to redeploy.

Bantams youth team fixtures and results are loaded automatically from the [fulltimeFeeds](https://github.com/touchlineHQ/fulltimeFeeds) feed.

## Pages

| Route | Page |
|-------|------|
| `/` | Home |
| `/about` | Club history |
| `/teams` | All teams |
| `/teams/:teamSlug` | Individual team with fixtures/results |
| `/fixtures` | Bantams fixtures and results feed |
| `/register` | Registration links |
| `/committee` | Committee members |
| `/news` | News articles |
| `/gallery` | Photo gallery |
| `/matchday` | Matchday info (directions, parking, facilities) |
| `/contact` | Contact form |
| `/customise` | Whitelabel config editor |

## Deployment

Pushing to `main` triggers a GitHub Actions workflow that builds the site and deploys `website/dist/` to GitHub Pages automatically.
