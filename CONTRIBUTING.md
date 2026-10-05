# Contributing

The tests need Node.js 20 or newer.

```sh
npm ci
npm run fetch-starter   # the theme starter used as a test corpus
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
