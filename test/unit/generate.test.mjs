// The generated files follow the contract, and the check fails when it moves (the drift a
// theme tools release can cause).
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
// The trimmed contract in data/contract.json is a valid contract to import.
const withContract = (mutate) => {
  const c = readJson(join(root, "data/contract.json"));
  mutate(c);
  const f = join(tmp, `contract-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(c));
  return run("--contract", f, "--source", c.source);
};

test("generated files are up to date", () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
});

test("a field the platform adds, drops or retypes fails the check", () => {
  let r = withContract((c) => c.schema_fields.structs.SettingDef.push({ name: "placeholder", go: "string", type: "string", omitempty: true }));
  assert.equal(r.code, 1);
  assert.match(r.out, /SettingDef\.placeholder is not in the schema/);
  r = withContract((c) => (c.schema_fields.structs.sectionSchema = c.schema_fields.structs.sectionSchema.filter((f) => f.name !== "preview_image")));
  assert.match(r.out, /"preview_image" is not a field of sectionSchema/);
  r = withContract((c) => Object.assign(c.schema_fields.structs.VisibleIf.find((f) => f.name === "set"), { go: "string", type: "string" }));
  assert.match(r.out, /VisibleIf\.set is string, so the schema type is string, not boolean/);
});

test("an unchanged contract passes; any other change makes data/contract.json stale", () => {
  let r = withContract(() => {});
  assert.equal(r.code, 0, r.out);
  r = withContract((c) => (c.settings_schema_version += 1));
  assert.equal(r.code, 1);
  assert.match(r.out, /Generated files are out of date: data\/contract\.json/);
});

test("a filter the platform adds or removes fails the check", () => {
  let r = withContract((c) => c.filters.storefront.push("money_with_currency"));
  assert.equal(r.code, 1);
  assert.match(r.out, /money_with_currency is a filter themes may call, but data\/filters.json does not document it/);
  r = withContract((c) => (c.filters.vascula = c.filters.vascula.filter((f) => f !== "slug")));
  assert.match(r.out, /slug is not a Vascula built-in filter/);
});

test("a contract with a new setting type fails until it is described", () => {
  const r = withContract((c) => c.setting_types.push("rating"));
  assert.equal(r.code, 1);
  assert.match(r.out, /setting type rating has no description/);
});
