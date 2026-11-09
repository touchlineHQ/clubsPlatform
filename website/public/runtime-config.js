// Runtime configuration, loaded by index.html before the app bundle.
//
// Deliberately empty in the repo and in the shared build. Deploy steps in
// .github/workflows overwrite this file per environment, so the same bundle can
// be promoted from preview to production. It is a file rather than an inline
// script because the CSP in _headers only allows script-src 'self'.
//
//   window.__POSTHOG_DISABLED__ = true;   // no PostHog events (preview, CI)
//   window.__POSTHOG_DISABLED__ = false;  // force on, e.g. in `npm run dev`
//
// Left unset, PostHog is off in dev and on in a production build.
