// The generated files follow the contract and the platform's structs, and the check fails
// when either moves (the drift a theme tools release can cause).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, root } from "./helpers.mjs";

const run = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(root, "scripts/generate.mjs"), "--check", ...args], { encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
};
const tmp = mkdtempSync(join(tmpdir(), "vascula-generate-"));
const withPlatform = (mutate) => {
  const p = readJson(join(root, "data/platform-fields.json"));
  mutate(p);
  const f = join(tmp, `platform-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(p));
  return run("--platform", f);
};

test("generated files are up to date", () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
});

test("a field the platform adds, drops or retypes fails the check", () => {
  let r = withPlatform((p) => p.structs.SettingDef.push({ name: "placeholder", go: "string", omitempty: true }));
  assert.equal(r.code, 1);
  assert.match(r.out, /SettingDef\.placeholder is not in the schema/);
  r = withPlatform((p) => (p.structs.sectionSchema = p.structs.sectionSchema.filter((f) => f.name !== "preview_image")));
  assert.match(r.out, /"preview_image" is not a field of sectionSchema/);
  r = withPlatform((p) => (p.structs.VisibleIf.find((f) => f.name === "set").go = "string"));
  assert.match(r.out, /VisibleIf\.set is string, so the schema type is string, not boolean/);
});

test("a filter the platform adds or removes fails the check", () => {
  let r = withPlatform((p) => p.values.StorefrontFilters.push("money_with_currency"));
  assert.equal(r.code, 1);
  assert.match(r.out, /money_with_currency is a filter themes may call, but data\/filters.json does not document it/);
  r = withPlatform((p) => (p.values.vasculaBuiltinFilters = p.values.vasculaBuiltinFilters.filter((f) => f !== "slug")));
  assert.match(r.out, /slug is not a Vascula built-in filter/);
});

test("a contract with a new setting type fails until it is described", () => {
  const c = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", join(root, "data/contract.json")], { encoding: "utf8" }));
  // Rebuild a full contract shape from the trimmed one, with one more setting type.
  const full = { ...c, setting_types: [...c.setting_types, "rating"], hosted_actions: c.hosted_actions };
  const f = join(tmp, "contract.json");
  writeFileSync(f, JSON.stringify(full));
  const r = run("--contract", f);
  assert.equal(r.code, 1);
  assert.match(r.out, /setting type rating has no description/);
});
