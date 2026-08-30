// This file is `.mts`, not `.ts`, and must stay that way. `@posthog/rollup-plugin`
// below is ESM-only, and website/package.json has no `"type": "module"`, so a
// plain `vite.config.ts` is loaded as CommonJS and the import fails the build
// with "ESM file cannot be loaded by `require`". The `.mts` extension is what
// tells Vite to load this config as ESM. tsconfig.json's `include` names this
// file explicitly, so it is still type-checked by the `tsc` in `npm run build`.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import posthog from '@posthog/rollup-plugin';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Source map upload to PostHog error tracking.
 *
 * Without this, every frontend `$exception` arrives pointing at a minified
 * chunk (`/assets/index-jayiAzaL.js`), which is unreadable to a human and
 * useless to the self-driving agent that is supposed to propose a fix. The
 * plugin injects a chunk id into each JS chunk, uploads the maps via
 * posthog-cli, and then deletes them so they never ship to Cloudflare Pages.
 *
 * `POSTHOG_CLI_API_KEY` is a **personal** API key (scopes: error tracking
 * write, organization read) and is emphatically NOT `POSTHOG_API_KEY`, which
 * is the project write key the Pages Functions use. They are different
 * credentials with very different blast radii — see README.
 *
 * Absent the key the plugin is left out entirely, so `npm run dev`, the
 * pull-request test workflow, and any local build behave exactly as before and
 * simply upload nothing. Only the deploy workflow on `main` has the secret.
 */
const posthogApiKey = process.env.POSTHOG_CLI_API_KEY;

/**
 * Stop a failed upload from failing the build.
 *
 * The plugin uploads in `writeBundle` and throws if posthog-cli exits non-zero
 * — an unreachable PostHog, or a rotated/expired personal API key. Because the
 * deploy job's `Build` step gates `wrangler pages deploy`, that throw would
 * stop the site from shipping. Source maps are an observability nicety;
 * shipping is the point, so an upload failure is downgraded to a warning.
 *
 * The cleanup is not optional. The plugin deletes the maps only after a
 * *successful* upload, deliberately leaving them on disk otherwise — so
 * swallowing the error without this would publish our source maps to
 * Cloudflare Pages. On failure we therefore delete them ourselves, and if even
 * that fails we rethrow: shipping the site is worth more than symbolication,
 * but not worth leaking source.
 */
function uploadFailureIsNotFatal(plugin: Plugin): Plugin {
  const writeBundle = plugin.writeBundle;
  if (typeof writeBundle !== 'object' || typeof writeBundle.handler !== 'function') {
    // The hook shape changed under us; leave the plugin exactly as it is
    // rather than silently dropping the upload.
    return plugin;
  }

  const handler = writeBundle.handler;

  return {
    ...plugin,
    writeBundle: {
      ...writeBundle,
      async handler(this: unknown, ...args: Parameters<typeof handler>) {
        try {
          return await handler.apply(this as never, args);
        } catch (error) {
          console.warn(
            `\n[posthog] source map upload failed, continuing the build anyway: ${error}\n` +
            '[posthog] frontend stack traces for this release will point at minified code.\n'
          );
          return undefined;
        } finally {
          const outDir = args[0]?.dir;
          if (outDir) {
            const maps = (await readdir(outDir, { recursive: true }))
              .filter((entry) => typeof entry === 'string' && entry.endsWith('.map'));
            await Promise.all(maps.map((map) => rm(join(outDir, map), { force: true })));
          }
        }
      },
    },
  };
}

const sourcemapPlugins = posthogApiKey
  ? [
      uploadFailureIsNotFatal(posthog({
        personalApiKey: posthogApiKey,
        projectId: process.env.POSTHOG_CLI_PROJECT_ID,
        host: process.env.POSTHOG_CLI_HOST,
        sourcemaps: {
          enabled: true,
          releaseName: 'clubsplatform-website',
          // The commit being deployed, so a stack trace can be read against
          // the exact source that produced it. Provided by GitHub Actions;
          // the plugin falls back to git metadata when it is unset.
          releaseVersion: process.env.GITHUB_SHA,
          deleteAfterUpload: true,
        },
      })),
    ]
  : [];

export default defineConfig({
  base: '/',
  // No `build.sourcemap` here on purpose: the PostHog plugin's own Vite
  // `config` hook sets it to 'hidden' when it is active, which both generates
  // the maps it needs and keeps the `sourceMappingURL` comment out of the
  // shipped bundle. Setting it here would turn maps on for every build,
  // including the ones that never upload them.
  plugins: [react(), ...sourcemapPlugins],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
