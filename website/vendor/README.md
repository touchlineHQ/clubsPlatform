# Vendored dependencies

## xlsx-0.20.3.tgz (SheetJS)

The `xlsx` package on npm is stuck at 0.18.5, which has known high-severity
issues (GHSA-5pgg-2g8v-p4x9 ReDoS, fixed in 0.20.2; GHSA-4r6h-8v6p-xvw6
prototype pollution, fixed in 0.19.3). SheetJS only publishes patched versions
from its own CDN, so we commit the tarball and depend on it with
`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`. This keeps `npm ci` hermetic.

Dependabot does not track this dependency. To upgrade:

1. Check https://cdn.sheetjs.com for the latest release.
2. `curl -LO https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz` into this folder.
3. Update the `xlsx` path in `website/package.json`, remove the old tgz.
4. Run `npm install` in `website/` (npm 10) and commit the lockfile.
5. Run typecheck, tests and build.
