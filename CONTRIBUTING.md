# Contributing

The tests need Node.js 20 or newer.

```sh
npm ci
npm run fetch-canvas    # Canvas, the default theme, used as a test corpus
npm test                # generated-file check, type check, grammar tests, unit tests
npm run package         # dist/vscode-vascula-<version>.vsix
xvfb-run -a npm run test:e2e -- --vsix dist/vscode-vascula-<version>.vsix   # in a real VS Code
```

To update the generated files after a theme tools release, print the contract with the [Tringify CLI](https://github.com/tringify/cli):

```sh
TRINGIFY_THEME_TOOLS_VERSION=vX.Y.Z tringify theme contract > contract.json
node scripts/generate.mjs --contract contract.json --source "tringify theme contract, theme-tools vX.Y.Z"
```

The contract carries everything the schemas are generated from and checked against: setting types, CTX names and fields, migration operations, the JSON fields of a section schema, `config/settings_schema.json` and a migration, the metafield setting owners, and the filters a theme may call. `data/contract.json` and the files in `schemas/` are generated from it; don't edit them by hand.

`npm test` (`npm run check-generated`) fails when the schemas list a field the contract doesn't have, miss one it has, give it another JSON type, or when `data/filters.json` documents a filter the contract doesn't list or misses one it lists. Describe the change in `scripts/generate.mjs` or `data/filters.json` until it passes. The weekly `contract.yml` workflow runs the same check against the newest theme tools release.
