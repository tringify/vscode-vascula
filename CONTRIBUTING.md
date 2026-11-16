# Contributing

The tests need Node.js 20 or newer.

```sh
npm ci
npm run fetch-canvas    # Canvas, the default theme, used as a test corpus
npm test                # generated-file check, type check, grammar tests, unit tests
npm run package         # dist/vscode-vascula-<version>.vsix
xvfb-run -a npm run test:e2e -- --vsix dist/vscode-vascula-<version>.vsix   # in a real VS Code
```

To update the generated schemas after a theme tools release, print the contract with the [Tringify CLI](https://github.com/tringify/cli) (or with `tringify-theme contract` from the theme tools):

```sh
TRINGIFY_THEME_TOOLS_VERSION=vX.Y.Z tringify theme contract > contract.json
node scripts/generate.mjs --contract contract.json --source "tringify theme contract, theme-tools vX.Y.Z"
```

`data/contract.json` and the files in `schemas/` are generated from that contract; don't edit them by hand.

The contract carries the vocabularies (setting types, CTX names, migration operations) but not the fields of a section schema, `config/settings_schema.json` or a migration, nor the filters a theme may call. Those come from the theme check source: the Go module the theme tools are built from (with `cmd/themecheck` and `vascula/`; it is not public). With a checkout at the commit whose `go run ./cmd/themecheck -contract` prints the same contract:

```sh
node scripts/platform-fields.mjs --source ../theme-check-source           # writes data/platform-fields.json
node scripts/platform-fields.mjs --source ../theme-check-source --check   # or only compare
npm run generate
```

`npm test` (`npm run check-generated`) fails when the schemas list a field the platform's structs don't have, miss one they have, give it another JSON type, or when `data/filters.json` documents a filter the theme check refuses or misses one it accepts. Describe the change in `scripts/generate.mjs` or `data/filters.json` until it passes.
