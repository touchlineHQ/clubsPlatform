/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * PostHog project API key. Injected at build time by the Build step in
   * .github/workflows/main.yml from a repository variable — this is a
   * direct-upload Pages project, so the Cloudflare dashboard's build
   * environment variables are not part of the build.
   *
   * Write-only public key: it ships in the client bundle by design.
   */
  readonly VITE_POSTHOG_API_KEY?: string;
  /** PostHog ingest host (our reverse proxy). Also allowlisted in public/_headers. */
  readonly VITE_POSTHOG_HOST?: string;
  /**
   * Set to 'true' to stop the SDK initialising. Defaults to on in dev; set it
   * to 'false' locally to verify the analytics pipeline end to end.
   */
  readonly VITE_POSTHOG_DISABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
