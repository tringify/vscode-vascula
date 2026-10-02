#!/usr/bin/env node
// Runs the extension inside a real VS Code against a copy of the theme starter.
//
//   node test/e2e/run.mjs                  test the development build (run `npm run build` first)
//   node test/e2e/run.mjs --vsix FILE      install FILE with the VS Code CLI and test the installed copy
//
// On Linux without a display, run under xvfb-run.
import { cpSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } = require("@vscode/test-electron");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const vsixIndex = args.indexOf("--vsix");
const vsix = vsixIndex >= 0 ? resolve(args[vsixIndex + 1]) : undefined;
const starter = process.env.STARTER_DIR ?? join(root, "test/.starter");
if (!existsSync(join(starter, "theme.json"))) throw new Error(`No theme starter at ${starter}. Run: npm run fetch-starter`);

const scratch = mkdtempSync(join(tmpdir(), "vscode-vascula-e2e-"));
try {
  const workspace = join(scratch, "theme");
  cpSync(starter, workspace, { recursive: true, filter: (p) => !p.includes(`${"/"}.git`) });

  const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION ?? "stable");
  let extensionDevelopmentPath = root;

  if (vsix) {
    const extensionsDir = join(scratch, "extensions");
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    const run = (...more) => {
      const r = spawnSync(cli, [...cliArgs, "--extensions-dir", extensionsDir, ...more], { encoding: "utf8", shell: process.platform === "win32" });
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      if (r.status !== 0) throw new Error(`VS Code CLI ${more.join(" ")} exited ${r.status}`);
      return r.stdout;
    };
    run("--install-extension", vsix, "--force");
    const listed = run("--list-extensions", "--show-versions");
    if (!/^tringify\.vscode-vascula@\d+\.\d+\.\d+$/m.test(listed)) throw new Error("the installed extension is not listed");
    const installed = readdirSync(extensionsDir).find((d) => d.startsWith("tringify.vscode-vascula-"));
    if (!installed) throw new Error("the installed extension folder is missing");
    extensionDevelopmentPath = join(extensionsDir, installed);
    console.log(`Installed ${vsix} → ${extensionDevelopmentPath}`);
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: join(root, "test/e2e/suite.cjs"),
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--user-data-dir",
      join(scratch, "user-data"),
    ],
    extensionTestsEnv: { VASCULA_E2E_WORKSPACE: workspace },
  });
  console.log("End-to-end tests passed.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
