# openapi-typegen

Isolated toolchain for `npm run api:gen` (in `/website`).

`openapi-typescript` (latest 7.13.0, peer `typescript ^5.x`) drives the TypeScript JS compiler API
(`ts.factory`), which TypeScript 7 (native compiler) does not expose. The app uses TypeScript 7; this
directory pins TypeScript 5 for the generator only, with its own lockfile. Dependabot can watch it
if a `/website/tools/openapi` npm entry is added. Drop this directory once openapi-typescript
supports TypeScript 7 (the `next` tag is `7.0.0-rc.1`, which does not).
